package transport

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"compress/zlib"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
)

// MaxStoredResponseBodyBytes caps the stored response body per sample (default 2 MB)
// to prevent decompression bombs from exhausting heap memory.
var MaxStoredResponseBodyBytes int64 = 2 * 1024 * 1024

type countingReader struct {
	reader io.Reader
	count  int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.reader.Read(p)
	c.count += int64(n)
	return n, err
}

// SampleResult captures detailed performance metrics for a single HTTP execution.
type SampleResult struct {
	Label           string
	URL             string
	Method          string
	StatusCode      int
	ResponseMessage string
	Success         bool
	TimestampMs     int64
	ElapsedMs       int64 // Rounded to nearest millisecond for standard JTL (no truncation)
	ElapsedUs       int64 // Microsecond resolution source of truth
	ConnectMs       int64 // Rounded to nearest millisecond
	ConnectUs       int64 // Microsecond resolution
	LatencyMs       int64 // Time to first byte, rounded to nearest millisecond
	LatencyUs       int64 // Time to first byte in microseconds
	BytesSent       int64
	BytesReceived   int64
	ErrorMessage    string
	ResponseBody    string
	ResponseHeaders http.Header
	SubSamples      []*SampleResult // Decomposed redirect hops or asset sub-requests
}

// JtlMillis rounds a time.Duration to the nearest millisecond, preventing floor bias.
func JtlMillis(d time.Duration) int64 {
	return d.Round(time.Millisecond).Milliseconds()
}

// ExecuteRequest dispatches an HTTP request with fine-grained timing tracing.
func ExecuteRequest(ctx context.Context, client *http.Client, method, rawURL, body string, headers map[string]string) (*SampleResult, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL %s: %w", rawURL, err)
	}

	var bodyReader io.Reader
	var bytesSent int64
	if body != "" && (method == "POST" || method == "PUT" || method == "PATCH") {
		bodyBytes := []byte(body)
		bytesSent = int64(len(bodyBytes))
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, parsedURL.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Apply headers
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	// Performance trace instrumentation
	var connectStart, connectEnd time.Time
	var gotFirstResponseByte time.Time

	trace := &httptrace.ClientTrace{
		ConnectStart: func(network, addr string) {
			connectStart = time.Now()
		},
		ConnectDone: func(network, addr string, err error) {
			connectEnd = time.Now()
		},
		GotFirstResponseByte: func() {
			gotFirstResponseByte = time.Now()
		},
	}

	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	startTime := time.Now()
	resp, err := client.Do(req)

	result := &SampleResult{
		Label:       parsedURL.Path,
		URL:         parsedURL.String(),
		Method:      method,
		TimestampMs: startTime.UnixMilli(),
		BytesSent:   bytesSent,
	}

	if err != nil {
		duration := time.Since(startTime)
		result.ElapsedMs = JtlMillis(duration)
		result.ElapsedUs = duration.Microseconds()
		result.Success = false
		result.ErrorMessage = err.Error()
		result.StatusCode = 0
		result.ResponseMessage = "Non HTTP response message: " + err.Error()
		return result, nil
	}
	defer resp.Body.Close()

	// Measure connect time
	if !connectEnd.IsZero() && !connectStart.IsZero() {
		connectDur := connectEnd.Sub(connectStart)
		result.ConnectMs = JtlMillis(connectDur)
		result.ConnectUs = connectDur.Microseconds()
	}

	// Measure latency (TTFB)
	var ttfbDur time.Duration
	if !gotFirstResponseByte.IsZero() {
		ttfbDur = gotFirstResponseByte.Sub(startTime)
	} else {
		ttfbDur = time.Since(startTime)
	}
	result.LatencyMs = JtlMillis(ttfbDur)
	result.LatencyUs = ttfbDur.Microseconds()

	// Wrap response body with wireReader to capture exact on-wire bytes read from the socket
	wireReader := &countingReader{reader: resp.Body}
	contentEncoding := resp.Header.Get("Content-Encoding")
	var respReader io.Reader = wireReader
	var closer io.Closer

	if strings.EqualFold(contentEncoding, "gzip") {
		gzReader, gzErr := gzip.NewReader(wireReader)
		if gzErr == nil {
			closer = gzReader
			respReader = gzReader
		}
	} else if strings.EqualFold(contentEncoding, "deflate") {
		// HTTP deflate (RFC 9110) standardly uses zlib framing (RFC 1950), though some legacy
		// servers omit the wrapper (raw RFC 1951). Peek first 2 bytes to distinguish zlib from raw flate.
		headerBuf := make([]byte, 2)
		n, _ := io.ReadFull(wireReader, headerBuf)
		header := headerBuf[:n]
		var combined io.Reader
		if len(header) > 0 {
			combined = io.MultiReader(bytes.NewReader(header), wireReader)
		} else {
			combined = wireReader
		}

		isZlib := len(header) >= 2 && (header[0]&0x0f == 8) && ((uint16(header[0])<<8|uint16(header[1]))%31 == 0)
		if isZlib {
			zReader, zErr := zlib.NewReader(combined)
			if zErr == nil {
				closer = zReader
				respReader = zReader
			} else {
				respReader = combined
			}
		} else {
			flateReader := flate.NewReader(combined)
			closer = flateReader
			respReader = flateReader
		}
	} else if strings.EqualFold(contentEncoding, "br") {
		brotliReader := brotli.NewReader(wireReader)
		respReader = brotliReader
	}

	// Read up to MaxStoredResponseBodyBytes into memory to prevent decompression bombs.
	// If body exceeds cap, storing stops, while remaining bytes are drained over the wire.
	limitReader := io.LimitReader(respReader, MaxStoredResponseBodyBytes)
	bodyBytes, readErr := io.ReadAll(limitReader)
	var closeErr error
	if closer != nil {
		closeErr = closer.Close()
	}
	if readErr == nil && closeErr != nil {
		readErr = closeErr
	}

	// Drain any remaining bytes from the underlying socket to allow keep-alive connection reuse
	// and ensure total on-wire byte metrics are completely accurate.
	_, drainErr := io.Copy(io.Discard, wireReader)

	elapsedDur := time.Since(startTime)
	result.ElapsedMs = JtlMillis(elapsedDur)
	result.ElapsedUs = elapsedDur.Microseconds()

	// Calculate total on-wire bytes: HTTP status line + headers + wire body
	// matching Apache JMeter's getBytesAsLong() wire accounting.
	var headerBytes int64
	if resp.Proto != "" && resp.Status != "" {
		headerBytes += int64(len(resp.Proto) + 1 + len(resp.Status) + 2)
	}
	for k, vv := range resp.Header {
		for _, v := range vv {
			headerBytes += int64(len(k) + 2 + len(v) + 2)
		}
	}
	headerBytes += 2 // trailing CRLF

	result.BytesReceived = wireReader.count + headerBytes
	result.StatusCode = resp.StatusCode
	result.ResponseMessage = resp.Status
	result.Success = (resp.StatusCode >= 200 && resp.StatusCode < 400)
	result.ResponseBody = string(bodyBytes)
	result.ResponseHeaders = resp.Header

	if readErr != nil && readErr != io.EOF {
		result.Success = false
		result.ErrorMessage = "Failed to read response body: " + readErr.Error()
	} else if drainErr != nil && drainErr != io.EOF {
		result.Success = false
		result.ErrorMessage = "Failed to drain response stream: " + drainErr.Error()
	} else if !result.Success {
		result.ErrorMessage = fmt.Sprintf("HTTP %d received", resp.StatusCode)
	}

	return result, nil
}

// BuildFullURL constructs the target URL string from domain, port, protocol, path, and arguments.
// If path is already a full URL (http:// or https://), it takes precedence matching Apache JMeter behavior.
func BuildFullURL(protocol, domain string, port int, path string, args map[string]string) string {
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		if len(args) == 0 {
			return path
		}
		values := url.Values{}
		for k, v := range args {
			values.Add(k, v)
		}
		delim := "?"
		if strings.Contains(path, "?") {
			delim = "&"
		}
		return path + delim + values.Encode()
	}

	if protocol == "" {
		protocol = "http"
	}
	if domain == "" {
		domain = "localhost"
	}
	base := fmt.Sprintf("%s://%s", protocol, domain)
	if (protocol == "http" && port != 80 && port > 0) || (protocol == "https" && port != 443 && port > 0) {
		base = fmt.Sprintf("%s:%d", base, port)
	}

	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	if len(args) == 0 {
		return base + path
	}

	// Append query parameters
	values := url.Values{}
	for k, v := range args {
		values.Add(k, v)
	}
	delim := "?"
	if strings.Contains(path, "?") {
		delim = "&"
	}
	return base + path + delim + values.Encode()
}

// ExecuteRequestDecomposed follows redirects iteratively, recording each intermediate hop as a SubSample.
func ExecuteRequestDecomposed(ctx context.Context, client *http.Client, method, rawURL, body string, headers map[string]string) (*SampleResult, error) {
	currentURL := rawURL
	currentMethod := method
	currentBody := body
	var subSamples []*SampleResult
	var totalBytesSent int64
	var totalBytesReceived int64
	parentStartTime := time.Now()

	// Clone client with CheckRedirect returning ErrUseLastResponse to intercept hops
	noRedirectClient := &http.Client{
		Transport: client.Transport,
		Jar:       client.Jar,
		Timeout:   client.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	maxRedirects := 10
	var finalResult *SampleResult

	for hop := 0; hop < maxRedirects; hop++ {
		hopResult, err := ExecuteRequest(ctx, noRedirectClient, currentMethod, currentURL, currentBody, headers)
		if err != nil {
			return nil, err
		}

		hopResult.Label = fmt.Sprintf("%s-%d", rawURL, hop)
		subSamples = append(subSamples, hopResult)
		totalBytesSent += hopResult.BytesSent
		totalBytesReceived += hopResult.BytesReceived
		finalResult = hopResult

		if hopResult.StatusCode >= 300 && hopResult.StatusCode < 400 {
			loc := hopResult.ResponseHeaders.Get("Location")
			if loc != "" {
				base, parseErr := url.Parse(currentURL)
				if parseErr == nil {
					target, relErr := base.Parse(loc)
					if relErr == nil {
						currentURL = target.String()
						// Convert method for 303 or 301/302 POST
						if hopResult.StatusCode == 303 || ((hopResult.StatusCode == 301 || hopResult.StatusCode == 302) && currentMethod == "POST") {
							currentMethod = "GET"
							currentBody = ""
						}
						continue
					}
				}
			}
		}

		// Terminal response reached
		break
	}

	totalDuration := time.Since(parentStartTime)
	parent := &SampleResult{
		Label:           finalResult.Label,
		URL:             finalResult.URL,
		Method:          method,
		StatusCode:      finalResult.StatusCode,
		ResponseMessage: finalResult.ResponseMessage,
		Success:         finalResult.Success,
		TimestampMs:     parentStartTime.UnixMilli(),
		ElapsedMs:       JtlMillis(totalDuration),
		ElapsedUs:       totalDuration.Microseconds(),
		ConnectMs:       finalResult.ConnectMs,
		ConnectUs:       finalResult.ConnectUs,
		LatencyMs:       finalResult.LatencyMs,
		LatencyUs:       finalResult.LatencyUs,
		BytesSent:       totalBytesSent,
		BytesReceived:   totalBytesReceived,
		ErrorMessage:    finalResult.ErrorMessage,
		ResponseBody:    finalResult.ResponseBody,
		ResponseHeaders: finalResult.ResponseHeaders,
		SubSamples:      subSamples,
	}

	return parent, nil
}
