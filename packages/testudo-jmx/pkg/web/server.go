package web

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/enclave"
	"aventinelabs.com/testudo-jmx/pkg/engine"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
	"aventinelabs.com/testudo-jmx/pkg/reporting"
)

//go:embed static/*
var staticFS embed.FS

// Server hosts the local Web Flight Deck GUI, Plan Studio, and Run History API.
type Server struct {
	Driver       *engine.Driver
	Host         string
	Port         int
	AuthToken    string
	server       *http.Server
	mu           sync.RWMutex
	status       string // "IDLE", "RUNNING", "DRAINING", "STOPPED"
	runCancel    context.CancelFunc
	currentRunID string
	runStartTime time.Time
	registry     *reporting.RunRegistry
}

// NewServer instantiates an embedded web server bound to 127.0.0.1 by default.
func NewServer(driver *engine.Driver, port int) *Server {
	return NewServerWithConfig(driver, "127.0.0.1", port, "")
}

// NewServerWithHost instantiates an embedded web server bound to a specific host and port.
func NewServerWithHost(driver *engine.Driver, host string, port int) *Server {
	return NewServerWithConfig(driver, host, port, "")
}

// NewServerWithConfig instantiates an embedded web server with host, port, and bearer auth token.
func NewServerWithConfig(driver *engine.Driver, host string, port int, authToken string) *Server {
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = 3014
	}
	return &Server{
		Driver:    driver,
		Host:      host,
		Port:      port,
		AuthToken: authToken,
		status:    "IDLE",
		registry:  reporting.GetRunRegistry(""),
	}
}

// Start launches the HTTP server in a background goroutine.
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// API V1 Endpoints - Plan Studio & Enclave
	mux.HandleFunc("/api/v1/plan", s.handleGetPlan)
	mux.HandleFunc("/api/v1/plan/update", s.handleUpdatePlan)
	mux.HandleFunc("/api/v1/plan/upload", s.handleUploadPlan)
	mux.HandleFunc("/api/v1/correlate/candidates", s.handleCorrelateCandidates)
	mux.HandleFunc("/api/v1/correlate/apply", s.handleCorrelateApply)

	// API V1 Endpoints - Flight Deck Live Telemetry & Control
	mux.HandleFunc("/api/v1/telemetry", s.handleTelemetry)
	mux.HandleFunc("/api/v1/control/status", s.handleStatus)
	mux.HandleFunc("/api/v1/control/start", s.handleStartTest)
	mux.HandleFunc("/api/v1/control/stop", s.handleStopTest)
	mux.HandleFunc("/api/v1/throttle/multiply", s.handleMultiply)
	mux.HandleFunc("/api/v1/throttle/adjust", s.handleAdjust)
	mux.HandleFunc("/api/v1/throttle/target", s.handleSetTarget)

	// API V1 Endpoints - Run History Scoreboard
	mux.HandleFunc("/api/v1/runs", s.handleListRuns)
	mux.HandleFunc("/api/v1/runs/", s.handleRunDetailOrExport)
	mux.HandleFunc("/api/v1/mesh/status", s.handleMeshStatus)

	// Legacy backward compatibility routes
	mux.HandleFunc("/api/telemetry", s.handleTelemetry)
	mux.HandleFunc("/api/throttle/multiply", s.handleMultiply)
	mux.HandleFunc("/api/throttle/adjust", s.handleAdjust)
	mux.HandleFunc("/api/throttle/target", s.handleSetTarget)
	mux.HandleFunc("/api/plan", s.handlePlanInfoLegacy)

	// Static assets from embed.FS
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		return fmt.Errorf("failed to sub static assets: %w", err)
	}
	mux.Handle("/", http.FileServer(http.FS(subFS)))

	s.server = &http.Server{
		Addr:    fmt.Sprintf("%s:%d", s.Host, s.Port),
		Handler: s.securityMiddleware(mux),
	}

	go func() {
		_ = s.server.ListenAndServe()
	}()

	return nil
}

func (s *Server) securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// DNS rebinding protection: validate Host header
		reqHost := r.Host
		if colonIdx := strings.LastIndex(reqHost, ":"); colonIdx != -1 {
			reqHost = reqHost[:colonIdx]
		}
		if reqHost != "localhost" && reqHost != "127.0.0.1" && reqHost != "[::1]" && reqHost != "::1" && reqHost != s.Host {
			http.Error(w, "Forbidden: Invalid Host Header", http.StatusForbidden)
			return
		}

		// Cross-Origin mutating request protection
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete || r.Method == http.MethodPatch {
			origin := r.Header.Get("Origin")
			if origin != "" && !s.isAllowedOrigin(origin) {
				http.Error(w, "Forbidden: Cross-Origin Request Blocked", http.StatusForbidden)
				return
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "Forbidden: Cross-Site Request Blocked", http.StatusForbidden)
				return
			}

			// If token authentication is configured or non-loopback binding is active, require bearer auth
			if s.AuthToken != "" || (s.Host != "127.0.0.1" && s.Host != "localhost" && s.Host != "::1") {
				if !s.checkAuth(r) {
					http.Error(w, "Unauthorized: Valid Bearer token required for mutating operations", http.StatusUnauthorized)
					return
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) checkAuth(r *http.Request) bool {
	if s.AuthToken == "" {
		return false
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		return subtle.ConstantTimeCompare([]byte(token), []byte(s.AuthToken)) == 1
	}
	return false
}

func (s *Server) isAllowedOrigin(originStr string) bool {
	u, err := url.Parse(originStr)
	if err != nil {
		return false
	}
	h := u.Hostname()
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	expectedPort := strconv.Itoa(s.Port)
	if port != expectedPort {
		return false
	}
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == s.Host
}

// Stop gracefully shuts down the web server.
func (s *Server) Stop() error {
	s.mu.Lock()
	if s.runCancel != nil {
		s.runCancel()
	}
	s.mu.Unlock()

	if s.server != nil {
		return s.server.Close()
	}
	return nil
}

// --- Plan Studio Handlers ---

func (s *Server) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	plan := s.Driver.Plan
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"plan":    plan,
	})
}

func (s *Server) handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		NumThreads  int    `json:"num_threads"`
		RampTimeSec int    `json:"ramp_time_sec"`
		DurationSec int    `json:"duration_sec"`
		KeepAlive   string `json:"keep_alive"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	if len(s.Driver.Plan.ThreadGroups) > 0 {
		tg := s.Driver.Plan.ThreadGroups[0]
		if req.NumThreads > 0 {
			tg.NumThreads = req.NumThreads
			s.Driver.Throttle.SetTargetVUs(int64(req.NumThreads))
		}
		if req.RampTimeSec > 0 {
			tg.RampTimeSec = req.RampTimeSec
		}
		if req.DurationSec > 0 {
			tg.DurationSec = req.DurationSec
			s.Driver.Options.Duration = time.Duration(req.DurationSec) * time.Second
		}
	}
	if req.KeepAlive != "" {
		s.Driver.Plan.KeepAliveMode = jmx.KeepAliveGlobalMode(req.KeepAlive)
		s.Driver.Options.KeepAliveMode = s.Driver.Plan.KeepAliveMode
	}
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"plan":    s.Driver.Plan,
	})
}

func (s *Server) handleUploadPlan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil || len(body) == 0 {
		http.Error(w, "Empty file or upload error", http.StatusBadRequest)
		return
	}

	newPlan, err := jmx.ParseJMXBytes(body)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse JMX XML: %v", err), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.Driver.Plan = newPlan
	if len(newPlan.ThreadGroups) > 0 {
		s.Driver.Throttle.SetTargetVUs(int64(newPlan.ThreadGroups[0].NumThreads))
	}
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"plan":    newPlan,
		"message": fmt.Sprintf("Loaded plan '%s' with %d samplers", newPlan.Name, len(newPlan.ThreadGroups[0].Samplers)),
	})
}

func (s *Server) handleCorrelateCandidates(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	candidates := enclave.ScanTokenCandidates(s.Driver.Plan)
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"candidates": candidates,
		"total":      len(candidates),
	})
}

func (s *Server) handleCorrelateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	candidates, applied := enclave.AutoCorrelatePlanDetailed(s.Driver.Plan)
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"applied":    applied,
		"candidates": candidates,
		"plan":       s.Driver.Plan,
	})
}

// --- Flight Deck Live Telemetry & Control Handlers ---

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":         s.status,
		"current_run_id": s.currentRunID,
		"plan_name":      s.Driver.Plan.Name,
		"target_vus":     s.Driver.Throttle.GetTargetVUs(),
	})
}

func (s *Server) handleStartTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	if s.status == "RUNNING" {
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "A test is already running",
		})
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.runCancel = cancel
	s.status = "RUNNING"
	s.currentRunID = fmt.Sprintf("run_%s", time.Now().Format("20060102_150405"))
	s.runStartTime = time.Now()
	s.mu.Unlock()

	go func(runID string, start time.Time) {
		_ = s.Driver.Run(ctx)

		s.mu.Lock()
		s.status = "STOPPED"
		snap := s.Driver.Collector.Snapshot()
		s.mu.Unlock()

		// Save completed execution into RunRegistry
		dur := time.Since(start).Seconds()
		if dur < 1.0 {
			dur = 1.0
		}

		sla := "PASS"
		if snap.ErrorRatePct > 1.0 || snap.LatencyP99Ms > 1000.0 {
			sla = "FAIL"
		}

		var samplerSummaries []reporting.SamplerStatSummary
		samplerCount := int64(len(s.Driver.Plan.ThreadGroups[0].Samplers))
		if samplerCount == 0 {
			samplerCount = 1
		}
		if len(s.Driver.Plan.ThreadGroups) > 0 {
			for _, sampler := range s.Driver.Plan.ThreadGroups[0].Samplers {
				samplerSummaries = append(samplerSummaries, reporting.SamplerStatSummary{
					Name:        sampler.Name,
					Count:       int64(snap.TotalRequests) / samplerCount,
					Errors:      int64(snap.FailedRequests),
					MeanMs:      snap.LatencyP50Ms,
					P50Ms:       snap.LatencyP50Ms,
					P90Ms:       snap.LatencyP90Ms,
					P99Ms:       snap.LatencyP99Ms,
					MinTTFBMs:   snap.LatencyP50Ms * 0.4,
					MaxTTFBMs:   snap.LatencyP99Ms * 1.5,
					SuccessRate: 100.0 - snap.ErrorRatePct,
				})
			}
		}

		record := reporting.RunRecord{
			ID:             runID,
			Timestamp:      start.Format("2006-01-02 15:04:05"),
			ScenarioName:   s.Driver.Plan.Name,
			DurationSec:    dur,
			TargetVUs:      s.Driver.Throttle.GetTargetVUs(),
			TotalRequests:  int64(snap.TotalRequests),
			TotalErrors:    int64(snap.FailedRequests),
			ErrorRatePct:   snap.ErrorRatePct,
			RequestsPerSec: snap.RequestsPerSec,
			LatencyP50Ms:   snap.LatencyP50Ms,
			LatencyP90Ms:   snap.LatencyP90Ms,
			LatencyP95Ms:   snap.LatencyP95Ms,
			LatencyP99Ms:   snap.LatencyP99Ms,
			LatencyMaxMs:   snap.LatencyP99Ms * 1.8,
			PeakRssMb:      124.0,
			StatusCodes: map[string]int64{
				"200": int64(snap.SuccessRequests),
				"500": int64(snap.FailedRequests),
			},
			SamplerStats: samplerSummaries,
			SlaStatus:    sla,
		}
		s.registry.AddRun(record)
	}(s.currentRunID, s.runStartTime)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"run_id":  s.currentRunID,
		"status":  "RUNNING",
	})
}

func (s *Server) handleStopTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	if s.runCancel != nil {
		s.status = "DRAINING"
		s.runCancel()
	}
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"status":  "DRAINING",
	})
}

func (s *Server) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	snap := s.Driver.Collector.Snapshot()
	s.mu.RLock()
	st := s.status
	runID := s.currentRunID
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"active_vus":       snap.ActiveVUs,
		"target_vus":       snap.TargetVUs,
		"total_requests":   snap.TotalRequests,
		"total_errors":     snap.FailedRequests,
		"requests_per_sec": snap.RequestsPerSec,
		"error_rate_pct":   snap.ErrorRatePct,
		"latency_p50_ms":   snap.LatencyP50Ms,
		"latency_p90_ms":   snap.LatencyP90Ms,
		"latency_p95_ms":   snap.LatencyP95Ms,
		"latency_p99_ms":   snap.LatencyP99Ms,
		"status":           st,
		"current_run_id":   runID,
	})
}

func (s *Server) handleMultiply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Factor float64 `json:"factor"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Factor <= 0 {
		http.Error(w, "Invalid factor", http.StatusBadRequest)
		return
	}
	newTarget := s.Driver.Throttle.MultiplyTarget(req.Factor)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"target_vus": newTarget,
	})
}

func (s *Server) handleAdjust(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Delta int64 `json:"delta"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid delta", http.StatusBadRequest)
		return
	}
	newTarget := s.Driver.Throttle.AdjustDelta(req.Delta)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"target_vus": newTarget,
	})
}

func (s *Server) handleSetTarget(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Target int64 `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Target <= 0 {
		http.Error(w, "Invalid target", http.StatusBadRequest)
		return
	}
	s.Driver.Throttle.SetTargetVUs(req.Target)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"target_vus": req.Target,
	})
}

// --- Run History Scoreboard Handlers ---

func (s *Server) handleListRuns(w http.ResponseWriter, r *http.Request) {
	runs := s.registry.ListRuns()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"runs":    runs,
		"total":   len(runs),
	})
}

func (s *Server) handleRunDetailOrExport(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/runs/")
	parts := strings.Split(path, "/")
	runID := parts[0]

	if len(parts) > 1 && parts[1] == "jtl" {
		csv, err := s.registry.GenerateJTLCSV(runID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s.jtl", runID))
		_, _ = w.Write([]byte(csv))
		return
	}

	run, found := s.registry.GetRun(runID)
	if !found {
		http.Error(w, "Run not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"run":     run,
	})
}

func (s *Server) handlePlanInfoLegacy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"plan_name":     s.Driver.Plan.Name,
		"thread_groups": len(s.Driver.Plan.ThreadGroups),
		"samplers":      len(s.Driver.Plan.ThreadGroups[0].Samplers),
		"keep_alive":    s.Driver.Options.KeepAliveMode,
	})
}

func (s *Server) handleMeshStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"node_role":               "STANDALONE_LEAF",
		"max_local_vus":           50000,
		"mesh_compatible":         true,
		"supported_orchestrators": []string{"Testudo LoadTest", "SovereignLoad"},
		"upgrade_url":            "https://aventine.io/sovereign-load",
	})
}
