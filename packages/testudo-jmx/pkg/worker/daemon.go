package worker

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/engine"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

// RunRequest encapsulates an incoming test execution directive from an orchestrator.
type RunRequest struct {
	JMXContent         string `json:"jmx_content"`
	OverrideVUs        int    `json:"override_vus"`
	DurationSec        int    `json:"duration_sec"`
	RampRate           int    `json:"ramp_rate"`
	UdpTelemetryTarget string `json:"udp_telemetry_target"`
	WorkerID           string `json:"worker_id"`
}

// WorkerStatus represents the operational state of the leaf worker node.
type WorkerStatus struct {
	Status        string  `json:"status"` // "IDLE" or "RUNNING"
	Role          string  `json:"role"`   // "MESH_LEAF"
	WorkerID      string  `json:"worker_id"`
	NumCPU        int     `json:"num_cpu"`
	ActiveVUs     int64   `json:"active_vus"`
	TargetVUs     int64   `json:"target_vus"`
	CurrentRPS    float64 `json:"current_rps"`
	TotalRequests uint64  `json:"total_requests"`
}

// WorkerDaemon manages the HTTP control interface for headless leaf execution.
type WorkerDaemon struct {
	host       string
	port       int
	authToken  string
	server     *http.Server
	mu         sync.Mutex
	status     string
	workerID   string
	driver     *engine.Driver
	cancelFunc context.CancelFunc
	streamer   *UdpStreamer
}

// NewWorkerDaemon creates a worker daemon bound to loopback (127.0.0.1) on the specified port.
func NewWorkerDaemon(port int) *WorkerDaemon {
	return NewWorkerDaemonWithConfig("127.0.0.1", port, "")
}

// NewWorkerDaemonWithConfig creates a worker daemon with explicit host, port, and bearer token.
// If authToken is empty, it checks TESTUDO_WORKER_TOKEN or generates an ephemeral cryptographically secure token.
func NewWorkerDaemonWithConfig(host string, port int, authToken string) *WorkerDaemon {
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = 9091
	}

	if authToken == "" {
		authToken = os.Getenv("TESTUDO_WORKER_TOKEN")
	}
	if authToken == "" {
		b := make([]byte, 16)
		_, _ = rand.Read(b)
		authToken = hex.EncodeToString(b)
	}

	d := &WorkerDaemon{
		host:      host,
		port:      port,
		authToken: authToken,
		status:    "IDLE",
		workerID:  fmt.Sprintf("testudo-leaf-%d", port),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", d.handleHealth)
	mux.HandleFunc("/api/worker/health", d.handleHealth)
	mux.HandleFunc("/api/worker/status", d.handleHealth)
	mux.HandleFunc("/api/worker/run", d.handleRun)
	mux.HandleFunc("/api/worker/stop", d.handleStop)
	mux.HandleFunc("/api/worker/metrics", d.handleMetrics)

	d.server = &http.Server{
		Addr:    fmt.Sprintf("%s:%d", host, port),
		Handler: d.securityMiddleware(mux),
	}

	return d
}

// GetAuthToken returns the configured or generated bearer token.
func (d *WorkerDaemon) GetAuthToken() string {
	return d.authToken
}

func (d *WorkerDaemon) securityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// DNS rebinding protection: validate Host header
		reqHost := r.Host
		if colonIdx := strings.LastIndex(reqHost, ":"); colonIdx != -1 {
			reqHost = reqHost[:colonIdx]
		}
		if reqHost != "localhost" && reqHost != "127.0.0.1" && reqHost != "[::1]" && reqHost != "::1" && reqHost != d.host {
			http.Error(w, "Forbidden: Invalid Host Header", http.StatusForbidden)
			return
		}

		// Cross-Origin mutating request protection
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete || r.Method == http.MethodPatch {
			origin := r.Header.Get("Origin")
			if origin != "" && !d.isAllowedOrigin(origin) {
				http.Error(w, "Forbidden: Cross-Origin Request Blocked", http.StatusForbidden)
				return
			}
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "Forbidden: Cross-Site Request Blocked", http.StatusForbidden)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}

func (d *WorkerDaemon) isAllowedOrigin(originStr string) bool {
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
	expectedPort := strconv.Itoa(d.port)
	if port != expectedPort {
		return false
	}
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == d.host
}

func (d *WorkerDaemon) checkAuth(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimPrefix(auth, "Bearer ")
		return subtle.ConstantTimeCompare([]byte(token), []byte(d.authToken)) == 1
	}
	return false
}

// Start launches the daemon HTTP listener.
func (d *WorkerDaemon) Start() error {
	return d.server.ListenAndServe()
}

// Shutdown stops the daemon server and cancels any running test.
func (d *WorkerDaemon) Shutdown(ctx context.Context) error {
	d.mu.Lock()
	if d.cancelFunc != nil {
		d.cancelFunc()
	}
	if d.streamer != nil {
		d.streamer.Stop()
	}
	d.mu.Unlock()

	return d.server.Shutdown(ctx)
}

func (d *WorkerDaemon) handleHealth(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()

	st := WorkerStatus{
		Status:   d.status,
		Role:     "MESH_LEAF",
		WorkerID: d.workerID,
		NumCPU:   runtime.NumCPU(),
	}

	if d.driver != nil && d.driver.Collector != nil {
		snap := d.driver.Collector.Snapshot()
		st.ActiveVUs = snap.ActiveVUs
		st.TargetVUs = snap.TargetVUs
		st.CurrentRPS = snap.RequestsPerSec
		st.TotalRequests = snap.TotalRequests
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(st)
}

func (d *WorkerDaemon) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !d.checkAuth(r) {
		http.Error(w, "Unauthorized: Valid Bearer token required", http.StatusUnauthorized)
		return
	}

	var req RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request payload: %v", err), http.StatusBadRequest)
		return
	}

	if req.JMXContent == "" {
		http.Error(w, "must provide jmx_content (XML string payload)", http.StatusBadRequest)
		return
	}

	d.mu.Lock()
	if d.status == "RUNNING" {
		d.mu.Unlock()
		http.Error(w, "worker is already executing a test run", http.StatusConflict)
		return
	}

	plan, err := jmx.ParseJMXBytes([]byte(req.JMXContent))
	if err != nil {
		d.mu.Unlock()
		http.Error(w, fmt.Sprintf("failed to parse JMX plan: %v", err), http.StatusBadRequest)
		return
	}

	if req.WorkerID != "" {
		d.workerID = req.WorkerID
	}

	opts := jmx.ExecutionOptions{
		OverrideVUs: req.OverrideVUs,
		Duration:    time.Duration(req.DurationSec) * time.Second,
		RampRate:    req.RampRate,
	}

	drv := engine.NewDriver(plan, opts)
	ctx, cancel := context.WithCancel(context.Background())

	d.driver = drv
	d.cancelFunc = cancel
	d.status = "RUNNING"

	// Start UDP telemetry if configured
	if req.UdpTelemetryTarget != "" {
		streamer, sErr := NewUdpStreamer(req.UdpTelemetryTarget, d.workerID)
		if sErr == nil {
			d.streamer = streamer
			streamer.Start(drv.Collector, 500*time.Millisecond)
		}
	}

	d.mu.Unlock()

	go func() {
		_ = drv.Run(ctx)
		d.mu.Lock()
		if d.streamer != nil {
			d.streamer.Stop()
			d.streamer = nil
		}
		d.status = "IDLE"
		d.cancelFunc = nil
		d.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "STARTED",
		"worker_id": d.workerID,
		"target_vus": opts.OverrideVUs,
	})
}

func (d *WorkerDaemon) handleStop(w http.ResponseWriter, r *http.Request) {
	if !d.checkAuth(r) {
		http.Error(w, "Unauthorized: Valid Bearer token required", http.StatusUnauthorized)
		return
	}

	d.mu.Lock()
	defer d.mu.Unlock()

	if d.status != "RUNNING" || d.cancelFunc == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ALREADY_IDLE"})
		return
	}

	d.cancelFunc()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "STOPPING"})
}

func (d *WorkerDaemon) handleMetrics(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.driver == nil || d.driver.Collector == nil {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "NO_METRICS"})
		return
	}

	snap := d.driver.Collector.Snapshot()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}
