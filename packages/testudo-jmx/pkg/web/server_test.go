package web

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/engine"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

func createTestServer() *Server {
	plan := &jmx.TestPlan{
		Name: "Test Web Plan",
		ThreadGroups: []*jmx.ThreadGroup{
			{
				Name:        "Thread Group 1",
				NumThreads:  5,
				RampTimeSec: 2,
				DurationSec: 10,
				Samplers: []*jmx.HTTPSampler{
					{
						Name:   "Sampler 1 - Home",
						Method: "GET",
						Domain: "127.0.0.1",
						Port:   "9876",
						Path:   "/api/v1/auth/token",
					},
					{
						Name:   "Sampler 2 - Action",
						Method: "POST",
						Domain: "127.0.0.1",
						Port:   "9876",
						Path:   "/api/v1/data",
						Arguments: []*jmx.HTTPArgument{
							{
								Name:  "csrf_token",
								Value: "RAW_TOKEN",
							},
						},
					},
				},
			},
		},
	}
	opts := jmx.ExecutionOptions{
		PlanFile:    "test.jmx",
		OverrideVUs: 5,
	}
	driver := engine.NewDriver(plan, opts)
	return NewServer(driver, 3014)
}

func TestServerAPIEndpoints(t *testing.T) {
	srv := createTestServer()

	// 1. GET /api/v1/plan
	req := httptest.NewRequest("GET", "/api/v1/plan", nil)
	w := httptest.NewRecorder()
	srv.handleGetPlan(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for /api/v1/plan, got %d", w.Code)
	}

	var planResp struct {
		Success bool          `json:"success"`
		Plan    *jmx.TestPlan `json:"plan"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &planResp); err != nil || !planResp.Success {
		t.Fatalf("failed to decode plan response: %v", err)
	}
	if planResp.Plan.Name != "Test Web Plan" {
		t.Errorf("expected plan name 'Test Web Plan', got %s", planResp.Plan.Name)
	}

	// 2. GET /api/v1/correlate/candidates
	req = httptest.NewRequest("GET", "/api/v1/correlate/candidates", nil)
	w = httptest.NewRecorder()
	srv.handleCorrelateCandidates(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for correlate candidates, got %d", w.Code)
	}

	// 3. POST /api/v1/correlate/apply
	req = httptest.NewRequest("POST", "/api/v1/correlate/apply", nil)
	w = httptest.NewRecorder()
	srv.handleCorrelateApply(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for correlate apply, got %d", w.Code)
	}

	// 4. GET /api/v1/telemetry
	req = httptest.NewRequest("GET", "/api/v1/telemetry", nil)
	w = httptest.NewRecorder()
	srv.handleTelemetry(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for telemetry, got %d", w.Code)
	}

	// 5. POST /api/v1/throttle/multiply
	multBody, _ := json.Marshal(map[string]float64{"factor": 2.0})
	req = httptest.NewRequest("POST", "/api/v1/throttle/multiply", bytes.NewReader(multBody))
	w = httptest.NewRecorder()
	srv.handleMultiply(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for throttle multiply, got %d", w.Code)
	}

	// 6. GET /api/v1/runs
	req = httptest.NewRequest("GET", "/api/v1/runs", nil)
	w = httptest.NewRecorder()
	srv.handleListRuns(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for list runs, got %d", w.Code)
	}

	var runsResp struct {
		Success bool `json:"success"`
		Total   int  `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &runsResp); err != nil || runsResp.Total == 0 {
		t.Errorf("expected pre-seeded runs in list runs response")
	}
}

func TestServerSecurityMiddleware(t *testing.T) {
	srv := createTestServer()
	handler := srv.securityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	// 1. Valid local request should succeed
	req := httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "localhost:3014"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for local host, got %d", w.Code)
	}

	// 2. DNS rebinding attack with untrusted host should be blocked (403)
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "attacker-domain.com:3014"
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for untrusted Host header, got %d", w.Code)
	}

	// 3. Cross-origin POST with untrusted Origin should be blocked (403)
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "localhost:3014"
	req.Header.Set("Origin", "http://evil.com")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for evil Origin, got %d", w.Code)
	}

	// 4. Cross-site Sec-Fetch-Site should be blocked (403)
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "localhost:3014"
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for cross-site Sec-Fetch-Site, got %d", w.Code)
	}

	// 5. Origin with mismatched port (e.g. localhost:5173 vs 3014) must be BLOCKED (403)
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "localhost:3014"
	req.Header.Set("Origin", "http://localhost:5173")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for mismatched port in Origin, got %d", w.Code)
	}

	// 6. Origin with matching port http://localhost:3014 must SUCCEED (200)
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "localhost:3014"
	req.Header.Set("Origin", "http://localhost:3014")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for matching Origin port, got %d", w.Code)
	}

	// 7. Non-loopback host requires Bearer auth
	extSrv := NewServerWithConfig(srv.Driver, "0.0.0.0", 3014, "SECURE_GUI_TOKEN_77")
	extHandler := extSrv.securityMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Missing token -> 401
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "0.0.0.0:3014"
	w = httptest.NewRecorder()
	extHandler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for missing bearer token on non-loopback, got %d", w.Code)
	}

	// Valid token -> 200
	req = httptest.NewRequest("POST", "/api/v1/control/start", nil)
	req.Host = "0.0.0.0:3014"
	req.Header.Set("Authorization", "Bearer SECURE_GUI_TOKEN_77")
	w = httptest.NewRecorder()
	extHandler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK for valid bearer token on non-loopback, got %d", w.Code)
	}
}

