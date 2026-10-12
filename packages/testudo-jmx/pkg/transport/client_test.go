package transport_test

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/transport"
	"github.com/andybalholm/brotli"
)

func TestBuildFullURL(t *testing.T) {
	// 1. Standard component-based URL
	u1 := transport.BuildFullURL("http", "example.com", 8080, "/api/v1", map[string]string{"q": "test"})
	if u1 != "http://example.com:8080/api/v1?q=test" {
		t.Errorf("Unexpected standard URL: %s", u1)
	}

	// 2. Full URL directly in path (URL-based script)
	fullURL := "https://api.aventinelabs.com/checkout/order"
	u2 := transport.BuildFullURL("", "", 0, fullURL, nil)
	if u2 != fullURL {
		t.Errorf("Expected full URL %s, got %s", fullURL, u2)
	}

	// 3. Full URL with query arguments appended
	u3 := transport.BuildFullURL("", "", 0, fullURL, map[string]string{"ref": "jmeter"})
	if u3 != "https://api.aventinelabs.com/checkout/order?ref=jmeter" {
		t.Errorf("Unexpected URL with query args: %s", u3)
	}

	// 4. Default ports omitted in standard URLs
	u4 := transport.BuildFullURL("https", "example.com", 443, "status", nil)
	if u4 != "https://example.com/status" {
		t.Errorf("Expected port 443 omitted: %s", u4)
	}
}

func TestExecuteRequest_EncodingFormats(t *testing.T) {
	payload := "Hello, World! Token=ABCD1234XYZ"

	tests := []struct {
		name     string
		encoding string
		encode   func([]byte) []byte
	}{
		{
			name:     "gzip",
			encoding: "gzip",
			encode: func(b []byte) []byte {
				var buf bytes.Buffer
				zw := gzip.NewWriter(&buf)
				_, _ = zw.Write(b)
				_ = zw.Close()
				return buf.Bytes()
			},
		},
		{
			name:     "zlib-deflate (RFC 1950 standard)",
			encoding: "deflate",
			encode: func(b []byte) []byte {
				var buf bytes.Buffer
				zw := zlib.NewWriter(&buf)
				_, _ = zw.Write(b)
				_ = zw.Close()
				return buf.Bytes()
			},
		},
		{
			name:     "raw-flate (RFC 1951 fallback)",
			encoding: "deflate",
			encode: func(b []byte) []byte {
				var buf bytes.Buffer
				fw, _ := flate.NewWriter(&buf, flate.DefaultCompression)
				_, _ = fw.Write(b)
				_ = fw.Close()
				return buf.Bytes()
			},
		},
		{
			name:     "brotli",
			encoding: "br",
			encode: func(b []byte) []byte {
				var buf bytes.Buffer
				bw := brotli.NewWriter(&buf)
				_, _ = bw.Write(b)
				_ = bw.Close()
				return buf.Bytes()
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			compressed := tc.encode([]byte(payload))
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Encoding", tc.encoding)
				w.Header().Set("Content-Type", "text/plain")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(compressed)
			}))
			defer ts.Close()

			res, err := transport.ExecuteRequest(context.Background(), ts.Client(), "GET", ts.URL, "", nil)
			if err != nil {
				t.Fatalf("ExecuteRequest returned error: %v", err)
			}
			if !res.Success {
				t.Fatalf("Expected sample success=true, got false: %s", res.ErrorMessage)
			}
			if res.ResponseBody != payload {
				t.Errorf("Expected body %q, got %q", payload, res.ResponseBody)
			}
			if res.BytesReceived <= 0 {
				t.Errorf("Expected on-wire BytesReceived > 0, got %d", res.BytesReceived)
			}
		})
	}
}

func TestExecuteRequest_DecompressionBombCap(t *testing.T) {
	// Generate a 10MB repetitive string that compresses down to ~10KB in gzip
	largeUncompressed := strings.Repeat("AventineTestudo1234567890", 400000) // ~10 MB
	var gzBuf bytes.Buffer
	zw := gzip.NewWriter(&gzBuf)
	_, _ = zw.Write([]byte(largeUncompressed))
	_ = zw.Close()
	wireBytes := gzBuf.Bytes()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(wireBytes)
	}))
	defer ts.Close()

	headers := map[string]string{"Accept-Encoding": "gzip"}
	res, err := transport.ExecuteRequest(context.Background(), ts.Client(), "GET", ts.URL, "", headers)
	if err != nil {
		t.Fatalf("ExecuteRequest returned error: %v", err)
	}
	if !res.Success {
		t.Fatalf("Expected success=true, got false: %s", res.ErrorMessage)
	}
	// Body should be capped at MaxStoredResponseBodyBytes (2 MB)
	if int64(len(res.ResponseBody)) > transport.MaxStoredResponseBodyBytes {
		t.Errorf("Stored body length %d exceeds cap of %d", len(res.ResponseBody), transport.MaxStoredResponseBodyBytes)
	}
	// On-wire bytes must reflect wire transmission (headers + compressed body), not 10 MB!
	if res.BytesReceived > 1024*1024 {
		t.Errorf("BytesReceived should reflect wire size (~%d bytes), but was %d", len(wireBytes), res.BytesReceived)
	}
}
