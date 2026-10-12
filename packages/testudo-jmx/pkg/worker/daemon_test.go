package worker

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/engine"
)

const sampleJMX = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Test Plan" enabled="true">
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
    </TestPlan>
    <hashTree>
      <ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Thread Group" enabled="true">
        <stringProp name="ThreadGroup.num_threads">2</stringProp>
        <stringProp name="ThreadGroup.ramp_time">1</stringProp>
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController">
          <boolProp name="LoopController.continue_forever">false</boolProp>
          <stringProp name="LoopController.loops">1</stringProp>
        </elementProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Test HTTP" enabled="true">
          <stringProp name="HTTPSampler.domain">localhost</stringProp>
          <stringProp name="HTTPSampler.port">80</stringProp>
          <stringProp name="HTTPSampler.protocol">http</stringProp>
          <stringProp name="HTTPSampler.path">/</stringProp>
          <stringProp name="HTTPSampler.method">GET</stringProp>
        </HTTPSamplerProxy>
        <hashTree/>
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`

func TestWorkerDaemonLifecycle(t *testing.T) {
	daemon := NewWorkerDaemon(9099)

	// Test 1: Health check
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	daemon.handleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from health, got %d", w.Code)
	}

	var status WorkerStatus
	if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil {
		t.Fatalf("failed to decode health response: %v", err)
	}

	if status.Status != "IDLE" {
		t.Errorf("expected status IDLE, got %s", status.Status)
	}
	if status.Role != "MESH_LEAF" {
		t.Errorf("expected role MESH_LEAF, got %s", status.Role)
	}

	// Test 2: Run Request
	runBody := RunRequest{
		JMXContent:  sampleJMX,
		OverrideVUs: 1,
		DurationSec: 1,
		RampRate:    1,
		WorkerID:    "test-leaf-01",
	}
	bodyBytes, _ := json.Marshal(runBody)
	runReq := httptest.NewRequest("POST", "/api/worker/run", bytes.NewReader(bodyBytes))
	runW := httptest.NewRecorder()
	daemon.handleRun(runW, runReq)

	if runW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from run, got %d: %s", runW.Code, runW.Body.String())
	}

	// Verify running status
	healthReq := httptest.NewRequest("GET", "/api/worker/health", nil)
	healthW := httptest.NewRecorder()
	daemon.handleHealth(healthW, healthReq)

	var runStatus WorkerStatus
	_ = json.Unmarshal(healthW.Body.Bytes(), &runStatus)
	if runStatus.WorkerID != "test-leaf-01" {
		t.Errorf("expected worker_id test-leaf-01, got %s", runStatus.WorkerID)
	}

	// Test 3: Stop Request
	stopReq := httptest.NewRequest("POST", "/api/worker/stop", nil)
	stopW := httptest.NewRecorder()
	daemon.handleStop(stopW, stopReq)

	if stopW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from stop, got %d", stopW.Code)
	}

	// Wait for worker loop to conclude
	time.Sleep(100 * time.Millisecond)

	finalReq := httptest.NewRequest("GET", "/api/worker/health", nil)
	finalW := httptest.NewRecorder()
	daemon.handleHealth(finalW, finalReq)

	var finalStatus WorkerStatus
	_ = json.Unmarshal(finalW.Body.Bytes(), &finalStatus)
	if finalStatus.Status != "IDLE" {
		t.Errorf("expected status IDLE after stop, got %s", finalStatus.Status)
	}
}

func TestUdpTelemetryStreamer(t *testing.T) {
	// Set up local UDP listener
	addr, err := net.ResolveUDPAddr("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to resolve UDP: %v", err)
	}
	server, err := net.ListenUDP("udp", addr)
	if err != nil {
		t.Fatalf("failed to listen UDP: %v", err)
	}
	defer server.Close()

	streamer, err := NewUdpStreamer(server.LocalAddr().String(), "test-streamer")
	if err != nil {
		t.Fatalf("failed to create streamer: %v", err)
	}

	coll := engine.NewCollector(5)
	streamer.Start(coll, 50*time.Millisecond)

	// Read one UDP packet
	buf := make([]byte, 2048)
	_ = server.SetReadDeadline(time.Now().Add(1 * time.Second))
	n, _, err := server.ReadFrom(buf)
	if err != nil {
		t.Fatalf("failed to receive UDP packet: %v", err)
	}

	var payload TelemetryPayload
	if err := json.Unmarshal(buf[:n], &payload); err != nil {
		t.Fatalf("invalid json received over UDP: %v", err)
	}

	if payload.WorkerID != "test-streamer" {
		t.Errorf("expected worker_id test-streamer, got %s", payload.WorkerID)
	}

	streamer.Stop()
}

func TestWorkerDaemonAuthenticationAndLoopbackSecurity(t *testing.T) {
	// 1. Non-loopback daemon without token should reject mutating actions
	remoteDaemon := NewWorkerDaemonWithConfig("0.0.0.0", 9092, "")
	runBody := RunRequest{
		JMXContent: sampleJMX,
	}
	bodyBytes, _ := json.Marshal(runBody)
	req := httptest.NewRequest("POST", "/api/worker/run", bytes.NewReader(bodyBytes))
	w := httptest.NewRecorder()
	remoteDaemon.handleRun(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for non-loopback worker without token, got %d", w.Code)
	}

	// 2. Token-secured daemon rejects request without Authorization header
	securedDaemon := NewWorkerDaemonWithConfig("0.0.0.0", 9093, "super-secret-worker-key")
	req = httptest.NewRequest("POST", "/api/worker/run", bytes.NewReader(bodyBytes))
	w = httptest.NewRecorder()
	securedDaemon.handleRun(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for missing token, got %d", w.Code)
	}

	// 3. Token-secured daemon accepts request with valid Bearer token
	req = httptest.NewRequest("POST", "/api/worker/run", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer super-secret-worker-key")
	w = httptest.NewRecorder()
	securedDaemon.handleRun(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK with valid bearer token, got %d", w.Code)
	}

	// Stop the secured daemon
	stopReq := httptest.NewRequest("POST", "/api/worker/stop", nil)
	stopReq.Header.Set("Authorization", "Bearer super-secret-worker-key")
	stopW := httptest.NewRecorder()
	securedDaemon.handleStop(stopW, stopReq)
	if stopW.Code != http.StatusOK {
		t.Errorf("expected 200 OK from authorized stop, got %d", stopW.Code)
	}
}

