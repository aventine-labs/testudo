package engine

import (
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/transport"
)

// MetricSnapshot provides an immutable 60 FPS telemetry snapshot for the Web Flight Deck.
type MetricSnapshot struct {
	ActiveVUs         int64   `json:"active_vus"`
	TargetVUs         int64   `json:"target_vus"`
	TotalRequests     uint64  `json:"total_requests"`
	SuccessRequests   uint64  `json:"success_requests"`
	FailedRequests    uint64  `json:"failed_requests"`
	RequestsPerSec    float64 `json:"requests_per_sec"`
	BytesPerSec       float64 `json:"bytes_per_sec"`
	ErrorRatePct      float64 `json:"error_rate_pct"`
	LatencyP50Ms      float64 `json:"latency_p50_ms"`
	LatencyP90Ms      float64 `json:"latency_p90_ms"`
	LatencyP95Ms      float64 `json:"latency_p95_ms"`
	LatencyP99Ms      float64 `json:"latency_p99_ms"`
	LatencyMaxMs      float64 `json:"latency_max_ms"`
	ElapsedSec        float64 `json:"elapsed_sec"`
	SaturationKneeVUs int     `json:"saturation_knee_vus"`
	IsKneeDetected    bool    `json:"is_knee_detected"`
	OffClockMeanMs    float64 `json:"off_clock_mean_ms"`
	DroppedSamples    uint64  `json:"dropped_samples"`
}

// Collector records high-frequency execution telemetry without thread contention.
type Collector struct {
	mu              sync.RWMutex
	startTime       time.Time
	activeVUs       int64
	targetVUs       int64
	totalRequests   uint64
	successRequests uint64
	failedRequests  uint64
	totalBytesSent  uint64
	totalBytesRecv  uint64

	// Sliding latency window in microseconds for sub-millisecond precision
	latencySamplesUs []int64
	maxSamples       int
	sampleMu         sync.Mutex

	// Iteration cycle time and off-clock accounting
	totalIterations      uint64
	totalIterationDurUs  uint64
	totalOffClockUs      uint64
	droppedSamples       uint64

	// Saturation knee tracking
	kneeVUs        int
	kneeDetected   bool

	// History buffer for charts (last 60 seconds)
	history        []MetricSnapshot
}

// NewCollector instantiates a thread-safe telemetry collector.
func NewCollector(targetVUs int64) *Collector {
	return &Collector{
		startTime:        time.Now(),
		targetVUs:        targetVUs,
		maxSamples:       10000,
		latencySamplesUs: make([]int64, 0, 10000),
		history:          make([]MetricSnapshot, 0, 120),
	}
}

// RecordSample ingests a single completed HTTP transaction with atomic ops.
func (c *Collector) RecordSample(res *transport.SampleResult) {
	atomic.AddUint64(&c.totalRequests, 1)
	if res.Success {
		atomic.AddUint64(&c.successRequests, 1)
	} else {
		atomic.AddUint64(&c.failedRequests, 1)
	}
	atomic.AddUint64(&c.totalBytesSent, uint64(res.BytesSent))
	atomic.AddUint64(&c.totalBytesRecv, uint64(res.BytesReceived))

	// Sample microsecond latency for true sub-millisecond percentile calculations
	c.sampleMu.Lock()
	if len(c.latencySamplesUs) < c.maxSamples {
		c.latencySamplesUs = append(c.latencySamplesUs, res.ElapsedUs)
	} else {
		// Ring-buffer overwrite
		c.latencySamplesUs[atomic.LoadUint64(&c.totalRequests)%uint64(c.maxSamples)] = res.ElapsedUs
	}
	c.sampleMu.Unlock()
}

// RecordIteration logs iteration cycle duration and off-clock overhead.
func (c *Collector) RecordIteration(durationUs, offClockUs int64) {
	atomic.AddUint64(&c.totalIterations, 1)
	if durationUs > 0 {
		atomic.AddUint64(&c.totalIterationDurUs, uint64(durationUs))
	}
	if offClockUs > 0 {
		atomic.AddUint64(&c.totalOffClockUs, uint64(offClockUs))
	}
}

// RecordDroppedSample increments count of dropped samples when JTL buffer saturates.
func (c *Collector) RecordDroppedSample() {
	atomic.AddUint64(&c.droppedSamples, 1)
}

// SetActiveVUs updates the active virtual user count.
func (c *Collector) SetActiveVUs(vus int64) {
	atomic.StoreInt64(&c.activeVUs, vus)
}

// SetTargetVUs updates the desired virtual user count.
func (c *Collector) SetTargetVUs(vus int64) {
	atomic.StoreInt64(&c.targetVUs, vus)
}

// FlagKnee records that the saturation threshold was crossed.
func (c *Collector) FlagKnee(vus int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.kneeVUs = vus
	c.kneeDetected = true
}

// Snapshot computes real-time percentiles and rates for GUI and CLI emitters.
func (c *Collector) Snapshot() MetricSnapshot {
	now := time.Now()
	elapsedSec := now.Sub(c.startTime).Seconds()
	if elapsedSec < 0.001 {
		elapsedSec = 0.001
	}

	tot := atomic.LoadUint64(&c.totalRequests)
	succ := atomic.LoadUint64(&c.successRequests)
	fail := atomic.LoadUint64(&c.failedRequests)
	bytesRecv := atomic.LoadUint64(&c.totalBytesRecv)

	rps := float64(tot) / elapsedSec
	bps := float64(bytesRecv) / elapsedSec

	errRate := 0.0
	if tot > 0 {
		errRate = (float64(fail) / float64(tot)) * 100.0
	}

	// Compute percentiles from sampled window in microseconds, converted to fractional milliseconds
	c.sampleMu.Lock()
	copied := make([]int64, len(c.latencySamplesUs))
	copy(copied, c.latencySamplesUs)
	c.sampleMu.Unlock()

	var p50, p90, p95, p99, maxVal float64
	if len(copied) > 0 {
		sort.Slice(copied, func(i, j int) bool { return copied[i] < copied[j] })
		n := len(copied)
		p50 = float64(copied[int(float64(n)*0.50)]) / 1000.0
		p90 = float64(copied[int(float64(n)*0.90)]) / 1000.0
		p95 = float64(copied[int(float64(n)*0.95)]) / 1000.0
		idx99 := int(float64(n) * 0.99)
		if idx99 >= n {
			idx99 = n - 1
		}
		p99 = float64(copied[idx99]) / 1000.0
		maxVal = float64(copied[n-1]) / 1000.0
	}

	// Off-clock time per iteration in milliseconds
	var offClockMeanMs float64
	iters := atomic.LoadUint64(&c.totalIterations)
	if iters > 0 {
		totalOffClock := atomic.LoadUint64(&c.totalOffClockUs)
		offClockMeanMs = (float64(totalOffClock) / float64(iters)) / 1000.0
	}

	c.mu.RLock()
	snap := MetricSnapshot{
		ActiveVUs:         atomic.LoadInt64(&c.activeVUs),
		TargetVUs:         atomic.LoadInt64(&c.targetVUs),
		TotalRequests:     tot,
		SuccessRequests:   succ,
		FailedRequests:    fail,
		RequestsPerSec:    rps,
		BytesPerSec:       bps,
		ErrorRatePct:      errRate,
		LatencyP50Ms:      p50,
		LatencyP90Ms:      p90,
		LatencyP95Ms:      p95,
		LatencyP99Ms:      p99,
		LatencyMaxMs:      maxVal,
		ElapsedSec:        elapsedSec,
		SaturationKneeVUs: c.kneeVUs,
		IsKneeDetected:    c.kneeDetected,
		OffClockMeanMs:    offClockMeanMs,
		DroppedSamples:    atomic.LoadUint64(&c.droppedSamples),
	}
	c.mu.RUnlock()

	return snap
}
