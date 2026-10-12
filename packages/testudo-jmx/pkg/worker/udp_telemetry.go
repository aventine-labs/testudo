package worker

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/engine"
)

// TelemetryPayload represents an off-TCP compact UDP metrics packet sent to upstream orchestrators.
type TelemetryPayload struct {
	WorkerID       string  `json:"worker_id"`
	Hostname       string  `json:"hostname"`
	TimestampMs    int64   `json:"timestamp_ms"`
	ActiveVUs      int64   `json:"active_vus"`
	TargetVUs      int64   `json:"target_vus"`
	TotalRequests  uint64  `json:"total_requests"`
	FailedRequests uint64  `json:"failed_requests"`
	ThroughputRPS  float64 `json:"throughput_rps"`
	ErrorRatePct   float64 `json:"error_rate_pct"`
	P50Ms          float64 `json:"p50_ms"`
	P90Ms          float64 `json:"p90_ms"`
	P95Ms          float64 `json:"p95_ms"`
	P99Ms          float64 `json:"p99_ms"`
	BytesPerSec    float64 `json:"bytes_per_sec"`
	DroppedSamples uint64  `json:"dropped_samples"`
}

// UdpStreamer pushes periodic telemetry summaries to an upstream orchestrator via UDP.
type UdpStreamer struct {
	targetAddr string
	workerID   string
	hostname   string
	conn       *net.UDPConn
	stopChan   chan struct{}
	wg         sync.WaitGroup
}

// NewUdpStreamer creates a UDP telemetry emitter.
func NewUdpStreamer(targetAddr, workerID string) (*UdpStreamer, error) {
	raddr, err := net.ResolveUDPAddr("udp", targetAddr)
	if err != nil {
		return nil, fmt.Errorf("invalid UDP target address %s: %w", targetAddr, err)
	}

	conn, err := net.DialUDP("udp", nil, raddr)
	if err != nil {
		return nil, fmt.Errorf("failed to dial UDP %s: %w", targetAddr, err)
	}

	h, _ := os.Hostname()
	if workerID == "" {
		workerID = fmt.Sprintf("testudo-leaf-%s-%d", h, os.Getpid())
	}

	return &UdpStreamer{
		targetAddr: targetAddr,
		workerID:   workerID,
		hostname:   h,
		conn:       conn,
		stopChan:   make(chan struct{}),
	}, nil
}

// Start begins periodic background metric emission without blocking the load generation loop.
func (s *UdpStreamer) Start(collector *engine.Collector, interval time.Duration) {
	if interval <= 0 {
		interval = 500 * time.Millisecond
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-s.stopChan:
				return
			case <-ticker.C:
				snap := collector.Snapshot()
				payload := TelemetryPayload{
					WorkerID:       s.workerID,
					Hostname:       s.hostname,
					TimestampMs:    time.Now().UnixMilli(),
					ActiveVUs:      snap.ActiveVUs,
					TargetVUs:      snap.TargetVUs,
					TotalRequests:  snap.TotalRequests,
					FailedRequests: snap.FailedRequests,
					ThroughputRPS:  snap.RequestsPerSec,
					ErrorRatePct:   snap.ErrorRatePct,
					P50Ms:          snap.LatencyP50Ms,
					P90Ms:          snap.LatencyP90Ms,
					P95Ms:          snap.LatencyP95Ms,
					P99Ms:          snap.LatencyP99Ms,
					BytesPerSec:    snap.BytesPerSec,
					DroppedSamples: snap.DroppedSamples,
				}

				data, err := json.Marshal(payload)
				if err == nil && s.conn != nil {
					// Fire-and-forget: failure does not block load generation
					_, _ = s.conn.Write(data)
				}
			}
		}
	}()
}

// Stop flushes and closes the UDP socket.
func (s *UdpStreamer) Stop() {
	close(s.stopChan)
	s.wg.Wait()
	if s.conn != nil {
		_ = s.conn.Close()
	}
}
