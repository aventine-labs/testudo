package engine_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/engine"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
	"aventinelabs.com/testudo-jmx/pkg/reporting"
	"aventinelabs.com/testudo-jmx/pkg/transport"
)

func TestEngineFullExecution(t *testing.T) {
	// 1. Setup mock backend server
	tokenIssued := "MOCK_SECRET_TOKEN_999"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/auth/token":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"success","token":"` + tokenIssued + `"}`))

		case "/api/v1/data":
			bodyBytes, _ := io.ReadAll(r.Body)
			bodyStr := string(bodyBytes)
			// Verify that boundary extractor correctly propagated the dynamic token
			if !strings.Contains(bodyStr, tokenIssued) {
				http.Error(w, "Missing or incorrect auth token: "+bodyStr, http.StatusForbidden)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"result":"authenticated_data_ok"}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("Failed to parse mock server URL: %v", err)
	}

	host := u.Hostname()
	port, _ := strconv.Atoi(u.Port())

	// 2. Parse JMX fixture and point to mock server
	fixturePath := filepath.Join("..", "..", "fixtures", "sample_load_test.jmx")
	plan, err := jmx.ParseJMXFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to parse JMX fixture: %v", err)
	}

	// Override user variables to match httptest port
	plan.UserVariables["BASE_URL"] = host
	plan.UserVariables["APP_PORT"] = strconv.Itoa(port)

	// Set 3 threads, 3 loops
	plan.ThreadGroups[0].NumThreads = 3
	plan.ThreadGroups[0].LoopCount = 3

	tmpDir := t.TempDir()
	jtlPath := filepath.Join(tmpDir, "results.jtl")

	opts := jmx.ExecutionOptions{
		PlanFile:      fixturePath,
		JTLFile:       jtlPath,
		Duration:      10 * time.Second,
		KeepAliveMode: jmx.KeepAliveDefault,
		IsHeadless:    true,
	}

	driver := engine.NewDriver(plan, opts)
	jtlWriter, err := reporting.NewJTLWriter(jtlPath)
	if err != nil {
		t.Fatalf("Failed to open JTL writer: %v", err)
	}

	go func() {
		for sample := range driver.ResultChan {
			if !sample.Success {
				t.Logf("Failed sample: label=%s status=%d err=%s body=%s", sample.Label, sample.StatusCode, sample.ErrorMessage, sample.ResponseBody)
			}
			_ = jtlWriter.WriteSample(sample, "VU", int(driver.Collector.Snapshot().ActiveVUs))
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	runErr := driver.Run(ctx)
	if runErr != nil && runErr != context.Canceled && runErr != context.DeadlineExceeded {
		t.Fatalf("Driver run encountered error: %v", runErr)
	}

	_ = jtlWriter.Close()

	// 3. Assertions
	snap := driver.Collector.Snapshot()
	if snap.TotalRequests == 0 {
		t.Fatalf("Expected completed requests, got 0")
	}
	if snap.FailedRequests > 0 {
		t.Errorf("Expected 0 failed requests, got %d (error rate: %.2f%%)", snap.FailedRequests, snap.ErrorRatePct)
	}

	// Verify JTL log file exists and is non-empty
	info, err := os.Stat(jtlPath)
	if err != nil || info.Size() == 0 {
		t.Errorf("Expected non-empty JTL file at %s", jtlPath)
	}
}

func TestEnginePageBreaksAndLoopsExecution(t *testing.T) {
	// 1. Setup mock backend server
	searchHits := 0
	itemDetailHits := 0
	pageBreakRecorded := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html><body>Home Page</body></html>"))

		case r.URL.Path == "/categories":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html><body>Categories</body></html>"))

		case strings.HasPrefix(r.URL.Path, "/api/search"):
			searchHits++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","data":{"token":"TOKEN_SEARCH_SECRET_42"}}`))

		case strings.HasPrefix(r.URL.Path, "/api/item/"):
			itemDetailHits++
			if !strings.Contains(r.URL.Path, "TOKEN_SEARCH_SECRET_42") {
				http.Error(w, "Missing extracted token in item URL: "+r.URL.Path, http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"item_id":"item_42","status":"clean"}`))

		case r.URL.Path == "/cart":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"cart":"item_added"}`))

		case r.URL.Path == "/checkout":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"checkout":"confirmed"}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("Failed to parse mock server URL: %v", err)
	}
	host := u.Hostname()
	port := u.Port()

	// 2. Parse fixture
	fixturePath := filepath.Join("..", "..", "fixtures", "pagebreaks_and_loops_flow.jmx")
	plan, err := jmx.ParseJMXFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to parse fixture: %v", err)
	}

	// Update host/port across samplers in flow elements
	var updatePorts func(elements []*jmx.FlowElement)
	updatePorts = func(elements []*jmx.FlowElement) {
		for _, elem := range elements {
			if elem.Sampler != nil {
				elem.Sampler.Domain = host
				elem.Sampler.Port = port
			}
			if len(elem.Children) > 0 {
				updatePorts(elem.Children)
			}
		}
	}
	updatePorts(plan.ThreadGroups[0].FlowElements)

	// Configure 1 thread, 1 loop iteration to strictly verify loop counts
	plan.ThreadGroups[0].NumThreads = 1
	plan.ThreadGroups[0].LoopCount = 1

	tmpDir := t.TempDir()
	jtlPath := filepath.Join(tmpDir, "flow_results.jtl")

	opts := jmx.ExecutionOptions{
		PlanFile:      fixturePath,
		JTLFile:       jtlPath,
		Duration:      5 * time.Second,
		KeepAliveMode: jmx.KeepAliveDefault,
		IsHeadless:    true,
	}

	driver := engine.NewDriver(plan, opts)
	jtlWriter, err := reporting.NewJTLWriter(jtlPath)
	if err != nil {
		t.Fatalf("Failed to open JTL writer: %v", err)
	}

	samplesCollected := make([]*jmx.FlowElement, 0)
	_ = samplesCollected

	go func() {
		for sample := range driver.ResultChan {
			if sample.Method == "PAGE" {
				pageBreakRecorded++
				if sample.BytesReceived == 0 {
					t.Errorf("Page sample %s recorded 0 bytes", sample.Label)
				}
				if !sample.Success {
					t.Errorf("Page sample %s marked failed", sample.Label)
				}
			}
			if !sample.Success {
				t.Logf("Failed sample: label=%s status=%d err=%s body=%s", sample.Label, sample.StatusCode, sample.ErrorMessage, sample.ResponseBody)
			}
			_ = jtlWriter.WriteSample(sample, "VU", 1)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	runErr := driver.Run(ctx)
	if runErr != nil && runErr != context.Canceled && runErr != context.DeadlineExceeded {
		t.Fatalf("Driver run encountered error: %v", runErr)
	}

	_ = jtlWriter.Close()

	// 3. Verifications
	snap := driver.Collector.Snapshot()
	if snap.FailedRequests > 0 {
		t.Fatalf("Expected 0 failed requests, got %d", snap.FailedRequests)
	}

	// Inner loop was configured for 3 iterations per user session
	if searchHits == 0 || searchHits%3 != 0 {
		t.Errorf("Expected search hits to be a multiple of 3 from inner loop, got %d", searchHits)
	}
	if itemDetailHits != searchHits {
		t.Errorf("Expected item detail hits (%d) to match search hits (%d)", itemDetailHits, searchHits)
	}

	// Two TransactionControllers (01_Catalog_Browse and 03_Checkout_Flow) per user session
	if pageBreakRecorded == 0 || pageBreakRecorded%2 != 0 {
		t.Errorf("Expected page break samples to be a multiple of 2, got %d", pageBreakRecorded)
	}
}

func TestSingleSessionFlowExecution(t *testing.T) {
	// Setup mock backend server
	searchHits := 0
	itemDetailHits := 0
	pageBreaks := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>Home</html>"))

		case r.URL.Path == "/categories":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<html>Categories</html>"))

		case strings.HasPrefix(r.URL.Path, "/api/search"):
			searchHits++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","data":{"token":"TOKEN_EXACT_99"}}`))

		case strings.HasPrefix(r.URL.Path, "/api/item/"):
			itemDetailHits++
			if !strings.Contains(r.URL.Path, "TOKEN_EXACT_99") {
				http.Error(w, "Bad token: "+r.URL.Path, http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"clean_data"}`))

		case r.URL.Path == "/cart":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"cart":"ok"}`))

		case r.URL.Path == "/checkout":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"completed"}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, _ := url.Parse(server.URL)
	host := u.Hostname()
	port := u.Port()

	fixturePath := filepath.Join("..", "..", "fixtures", "pagebreaks_and_loops_flow.jmx")
	plan, err := jmx.ParseJMXFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to parse fixture: %v", err)
	}

	var updatePorts func(elements []*jmx.FlowElement)
	updatePorts = func(elements []*jmx.FlowElement) {
		for _, elem := range elements {
			if elem.Sampler != nil {
				elem.Sampler.Domain = host
				elem.Sampler.Port = port
			}
			if len(elem.Children) > 0 {
				updatePorts(elem.Children)
			}
		}
	}
	updatePorts(plan.ThreadGroups[0].FlowElements)

	coll := engine.NewCollector(1)
	resultChan := make(chan *transport.SampleResult, 100)
	tcfg := transport.DefaultTransportConfig()

	tg := plan.ThreadGroups[0]
	session := engine.NewUserSession(1, tg, plan, coll, resultChan, tcfg)

	ctx := context.Background()
	err = session.ExecuteIteration(ctx, tg.Samplers, plan.GlobalHeaders)
	if err != nil {
		t.Fatalf("Session execution failed: %v", err)
	}
	close(resultChan)

	for sample := range resultChan {
		if sample.Method == "PAGE" {
			pageBreaks++
			if sample.BytesReceived == 0 {
				t.Errorf("Page sample %s recorded 0 bytes", sample.Label)
			}
			if !sample.Success {
				t.Errorf("Page sample %s failed", sample.Label)
			}
		}
	}

	if searchHits != 3 {
		t.Errorf("Expected exactly 3 search hits, got %d", searchHits)
	}
	if itemDetailHits != 3 {
		t.Errorf("Expected exactly 3 item detail hits, got %d", itemDetailHits)
	}
	if pageBreaks != 2 {
		t.Errorf("Expected exactly 2 page break composite samples, got %d", pageBreaks)
	}
}

func TestEngineMultiThreadGroupExecution(t *testing.T) {
	var tg1Hits int64
	var tg2Hits int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/tg1":
			atomic.AddInt64(&tg1Hits, 1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("tg1_ok"))
		case "/tg2":
			atomic.AddInt64(&tg2Hits, 1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("tg2_ok"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	u, _ := url.Parse(server.URL)
	port := u.Port()

	plan := &jmx.TestPlan{
		Name: "Multi-TG Test Plan",
		ThreadGroups: []*jmx.ThreadGroup{
			{
				Name:       "Readers",
				Enabled:    true,
				NumThreads: 2,
				LoopCount:  1,
				Samplers: []*jmx.HTTPSampler{
					{
						Name:     "TG1 Sampler",
						Enabled:  true,
						Domain:   u.Hostname(),
						Port:     port,
						Protocol: "http",
						Path:     "/tg1",
						Method:   "GET",
					},
				},
			},
			{
				Name:       "Writers",
				Enabled:    true,
				NumThreads: 1,
				LoopCount:  1,
				Samplers: []*jmx.HTTPSampler{
					{
						Name:     "TG2 Sampler",
						Enabled:  true,
						Domain:   u.Hostname(),
						Port:     port,
						Protocol: "http",
						Path:     "/tg2",
						Method:   "POST",
					},
				},
			},
		},
	}

	opts := jmx.ExecutionOptions{
		Duration:   2 * time.Second,
		IsHeadless: true,
	}

	driver := engine.NewDriver(plan, opts)
	go func() {
		for range driver.ResultChan {
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_ = driver.Run(ctx)

	if atomic.LoadInt64(&tg1Hits) == 0 {
		t.Errorf("Expected tg1Hits > 0 from Readers thread group, got %d", atomic.LoadInt64(&tg1Hits))
	}
	if atomic.LoadInt64(&tg2Hits) == 0 {
		t.Errorf("Expected tg2Hits > 0 from Writers thread group, got %d", atomic.LoadInt64(&tg2Hits))
	}
}

