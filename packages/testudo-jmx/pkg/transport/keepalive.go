package transport

import (
	"crypto/tls"
	"net"
	"net/http"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

// TransportConfig defines socket and connection pooling parameters.
type TransportConfig struct {
	KeepAliveMode     jmx.KeepAliveGlobalMode
	RecycleOnIter     bool
	IdleConnTimeout   time.Duration
	MaxIdleConns      int
	MaxIdlePerHost    int
	MaxConnsPerHost   int
	ConnectTimeout    time.Duration
	ResponseTimeout   time.Duration
	DisableCompression bool
	InsecureSkipTLS    bool
}

// DefaultTransportConfig returns balanced high-concurrency settings.
func DefaultTransportConfig() TransportConfig {
	return TransportConfig{
		KeepAliveMode:      jmx.KeepAliveDefault,
		RecycleOnIter:      false,
		IdleConnTimeout:    90 * time.Second,
		MaxIdleConns:       20000,
		MaxIdlePerHost:     500,
		MaxConnsPerHost:    2000,
		ConnectTimeout:     10 * time.Second,
		ResponseTimeout:    30 * time.Second,
		DisableCompression: true, // Parity with JMeter default
		InsecureSkipTLS:    true,
	}
}

// BuildRoundTripper constructs an optimized http.Transport for high-load runs.
func BuildRoundTripper(cfg TransportConfig, forceClose bool) *http.Transport {
	disableKeepAlives := false
	if cfg.KeepAliveMode == jmx.KeepAliveForceOff || forceClose {
		disableKeepAlives = true
	}

	dialer := &net.Dialer{
		Timeout:   cfg.ConnectTimeout,
		KeepAlive: 15 * time.Second,
	}

	return &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          cfg.MaxIdleConns,
		MaxIdleConnsPerHost:   cfg.MaxIdlePerHost,
		MaxConnsPerHost:       cfg.MaxConnsPerHost,
		IdleConnTimeout:       cfg.IdleConnTimeout,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		DisableKeepAlives:     disableKeepAlives,
		DisableCompression:    cfg.DisableCompression,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: cfg.InsecureSkipTLS,
		},
	}
}
