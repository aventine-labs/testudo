package engine

import (
	"sync"
	"sync/atomic"
	"time"
)

// Throttle manages live concurrency scaling, multipliers, and knee hunting.
type Throttle struct {
	mu             sync.Mutex
	currentVUs     int64
	targetVUs      int64
	rampRateVUsSec int
	maxVUs         int64
	minVUs         int64
	autoHunter     bool
	lastStepTime   time.Time
	stepInterval   time.Duration
	stepFactor     float64 // e.g. 1.25 for +25%
	baselineP99    float64
}

// NewThrottle initializes a concurrency controller with safe boundaries.
func NewThrottle(initialVUs int64, rampRate int, autoHunter bool) *Throttle {
	if initialVUs <= 0 {
		initialVUs = 1
	}
	if rampRate <= 0 {
		rampRate = 5 // default 5 VUs/sec
	}
	return &Throttle{
		currentVUs:     0,
		targetVUs:      initialVUs,
		rampRateVUsSec: rampRate,
		maxVUs:         100000,
		minVUs:         1,
		autoHunter:     autoHunter,
		lastStepTime:   time.Now(),
		stepInterval:   30 * time.Second,
		stepFactor:     1.25,
	}
}

// GetTargetVUs returns the active target virtual user count.
func (t *Throttle) GetTargetVUs() int64 {
	return atomic.LoadInt64(&t.targetVUs)
}

// SetTargetVUs changes the target VUs with boundary clamping.
func (t *Throttle) SetTargetVUs(vus int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if vus < t.minVUs {
		vus = t.minVUs
	}
	if vus > t.maxVUs {
		vus = t.maxVUs
	}
	atomic.StoreInt64(&t.targetVUs, vus)
}

// MultiplyTarget scales the current target VUs by a factor (e.g. 2.0 for double, 0.5 for halve).
func (t *Throttle) MultiplyTarget(factor float64) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	curr := atomic.LoadInt64(&t.targetVUs)
	newVal := int64(float64(curr) * factor)
	if newVal < t.minVUs {
		newVal = t.minVUs
	}
	if newVal > t.maxVUs {
		newVal = t.maxVUs
	}
	atomic.StoreInt64(&t.targetVUs, newVal)
	return newVal
}

// AdjustDelta modifies the target VUs by a fixed delta (e.g. +10, -5).
func (t *Throttle) AdjustDelta(delta int64) int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	curr := atomic.LoadInt64(&t.targetVUs)
	newVal := curr + delta
	if newVal < t.minVUs {
		newVal = t.minVUs
	}
	if newVal > t.maxVUs {
		newVal = t.maxVUs
	}
	atomic.StoreInt64(&t.targetVUs, newVal)
	return newVal
}

// CheckAutoHunter processes ladder stepping if auto knee-hunting mode is enabled.
func (t *Throttle) CheckAutoHunter(snap MetricSnapshot, collector *Collector) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if !t.autoHunter || snap.IsKneeDetected {
		return
	}

	// Capture baseline p99 early in the run
	if t.baselineP99 == 0 && snap.LatencyP99Ms > 0 && snap.ElapsedSec > 10 {
		t.baselineP99 = snap.LatencyP99Ms
	}

	// Detect saturation knee: p99 doubles over baseline OR error rate exceeds 3.0%
	if t.baselineP99 > 0 && (snap.LatencyP99Ms > t.baselineP99*2.2 || snap.ErrorRatePct > 3.0) {
		collector.FlagKnee(int(snap.ActiveVUs))
		return
	}

	// Check if step interval has elapsed
	if time.Since(t.lastStepTime) >= t.stepInterval {
		t.lastStepTime = time.Now()
		curr := atomic.LoadInt64(&t.targetVUs)
		newVal := int64(float64(curr) * t.stepFactor)
		if newVal == curr {
			newVal++
		}
		if newVal > t.maxVUs {
			newVal = t.maxVUs
		}
		atomic.StoreInt64(&t.targetVUs, newVal)
	}
}
