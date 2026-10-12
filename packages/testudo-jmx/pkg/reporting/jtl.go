package reporting

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"aventinelabs.com/testudo-jmx/pkg/transport"
)

// JTLWriter records sample results to disk matching official Apache JMeter .jtl CSV schema,
// while simultaneously writing microsecond-resolution sidecar logs for precision benchmarking.
type JTLWriter struct {
	file            *os.File
	writer          *csv.Writer
	precisionFile   *os.File
	precisionWriter *csv.Writer
	mu              sync.Mutex
	unflushed       int
}

// NewJTLWriter opens or creates the .jtl output file and writes standard JMeter and precision headers.
func NewJTLWriter(filePath string) (*JTLWriter, error) {
	f, err := os.Create(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to create JTL file %s: %w", filePath, err)
	}

	w := csv.NewWriter(f)
	// Standard JMeter CSV Header
	header := []string{
		"timeStamp",
		"elapsed",
		"label",
		"responseCode",
		"responseMessage",
		"threadName",
		"dataType",
		"success",
		"failureMessage",
		"bytes",
		"sentBytes",
		"grpThreads",
		"allThreads",
		"URL",
		"Latency",
		"IdleTime",
		"Connect",
	}
	if err := w.Write(header); err != nil {
		f.Close()
		return nil, fmt.Errorf("failed to write JTL header: %w", err)
	}
	w.Flush()

	// Microsecond precision sidecar
	ext := filepath.Ext(filePath)
	precisionPath := strings.TrimSuffix(filePath, ext) + ".precision.csv"
	pf, err := os.Create(precisionPath)
	var pw *csv.Writer
	if err == nil {
		pw = csv.NewWriter(pf)
		precisionHeader := []string{
			"timeStamp",
			"elapsedUs",
			"label",
			"responseCode",
			"latencyUs",
			"connectUs",
			"bytes",
			"sentBytes",
			"threadName",
		}
		_ = pw.Write(precisionHeader)
		pw.Flush()
	}

	return &JTLWriter{
		file:            f,
		writer:          w,
		precisionFile:   pf,
		precisionWriter: pw,
	}, nil
}

// WriteSample appends a sample result row to the JTL log with buffered flushing.
func (j *JTLWriter) WriteSample(res *transport.SampleResult, threadName string, activeVUs int) error {
	j.mu.Lock()
	defer j.mu.Unlock()

	succStr := "true"
	if !res.Success {
		succStr = "false"
	}

	vusStr := strconv.Itoa(activeVUs)

	// Standard 17-column row (ms rounded)
	row := []string{
		strconv.FormatInt(res.TimestampMs, 10),
		strconv.FormatInt(res.ElapsedMs, 10),
		res.Label,
		strconv.Itoa(res.StatusCode),
		res.ResponseMessage,
		threadName,
		"text",
		succStr,
		res.ErrorMessage,
		strconv.FormatInt(res.BytesReceived, 10),
		strconv.FormatInt(res.BytesSent, 10),
		vusStr,
		vusStr,
		res.URL,
		strconv.FormatInt(res.LatencyMs, 10),
		"0",
		strconv.FormatInt(res.ConnectMs, 10),
	}

	if err := j.writer.Write(row); err != nil {
		return err
	}

	// Precision sidecar row (microseconds)
	if j.precisionWriter != nil {
		pRow := []string{
			strconv.FormatInt(res.TimestampMs, 10),
			strconv.FormatInt(res.ElapsedUs, 10),
			res.Label,
			strconv.Itoa(res.StatusCode),
			strconv.FormatInt(res.LatencyUs, 10),
			strconv.FormatInt(res.ConnectUs, 10),
			strconv.FormatInt(res.BytesReceived, 10),
			strconv.FormatInt(res.BytesSent, 10),
			threadName,
		}
		_ = j.precisionWriter.Write(pRow)
	}

	j.unflushed++
	if j.unflushed >= 250 {
		j.writer.Flush()
		if j.precisionWriter != nil {
			j.precisionWriter.Flush()
		}
		j.unflushed = 0
	}

	return nil
}

// Close flushes buffered writes and closes all underlying files.
func (j *JTLWriter) Close() error {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.writer.Flush()
	err := j.file.Close()

	if j.precisionWriter != nil {
		j.precisionWriter.Flush()
		if j.precisionFile != nil {
			_ = j.precisionFile.Close()
		}
	}

	return err
}
