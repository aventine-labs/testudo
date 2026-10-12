package transport

import (
	"net/http"
	"sync/atomic"
)

// TransportPool manages a striped array of high-capacity http.Transport instances.
// This prevents allocating one Transport per virtual user (which consumes gigabytes
// of memory and exhausts socket descriptors) while providing zero-contention
// concurrent round-tripping across CPU cores.
type TransportPool struct {
	transports []*RoundTripExecutor
	poolSize   int
	counter    uint64
	cfg        TransportConfig
}

// RoundTripExecutor wraps an *http.Transport for pooled execution.
type RoundTripExecutor struct {
	Transport *http.Transport
}

// NewTransportPool creates a pool of high-capacity transports.
func NewTransportPool(cfg TransportConfig, poolSize int) *TransportPool {
	if poolSize <= 0 {
		poolSize = 16
	}

	transports := make([]*RoundTripExecutor, poolSize)
	for i := 0; i < poolSize; i++ {
		transports[i] = &RoundTripExecutor{
			Transport: BuildRoundTripper(cfg, false),
		}
	}

	return &TransportPool{
		transports: transports,
		poolSize:   poolSize,
		cfg:        cfg,
	}
}

// Next acquires a pooled transport in a round-robin lock-free striped manner.
func (p *TransportPool) Next() *http.Transport {
	idx := atomic.AddUint64(&p.counter, 1) % uint64(p.poolSize)
	return p.transports[idx].Transport
}

// CloseIdleConnections flushes all idle sockets across all pooled transports.
func (p *TransportPool) CloseIdleConnections() {
	for _, t := range p.transports {
		if t != nil && t.Transport != nil {
			t.Transport.CloseIdleConnections()
		}
	}
}
