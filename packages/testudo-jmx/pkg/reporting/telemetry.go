package reporting

import (
	"fmt"
	"net/http"

	"aventinelabs.com/testudo-jmx/pkg/engine"
)

// PrometheusHandler exposes real-time Testudo-JMX metrics for Grafana scraping.
func PrometheusHandler(collector *engine.Collector) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		snap := collector.Snapshot()
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

		fmt.Fprintf(w, "# HELP testudo_jmx_active_vus Currently running virtual user goroutines\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_active_vus gauge\n")
		fmt.Fprintf(w, "testudo_jmx_active_vus %d\n\n", snap.ActiveVUs)

		fmt.Fprintf(w, "# HELP testudo_jmx_target_vus Desired virtual user target\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_target_vus gauge\n")
		fmt.Fprintf(w, "testudo_jmx_target_vus %d\n\n", snap.TargetVUs)

		fmt.Fprintf(w, "# HELP testudo_jmx_requests_total Total HTTP requests completed\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_requests_total counter\n")
		fmt.Fprintf(w, "testudo_jmx_requests_total %d\n\n", snap.TotalRequests)

		fmt.Fprintf(w, "# HELP testudo_jmx_requests_failed_total Total failed HTTP requests\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_requests_failed_total counter\n")
		fmt.Fprintf(w, "testudo_jmx_requests_failed_total %d\n\n", snap.FailedRequests)

		fmt.Fprintf(w, "# HELP testudo_jmx_requests_per_second Current throughput rate\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_requests_per_second gauge\n")
		fmt.Fprintf(w, "testudo_jmx_requests_per_second %.2f\n\n", snap.RequestsPerSec)

		fmt.Fprintf(w, "# HELP testudo_jmx_latency_milliseconds Response latency percentiles\n")
		fmt.Fprintf(w, "# TYPE testudo_jmx_latency_milliseconds summary\n")
		fmt.Fprintf(w, "testudo_jmx_latency_milliseconds{quantile=\"0.50\"} %.2f\n", snap.LatencyP50Ms)
		fmt.Fprintf(w, "testudo_jmx_latency_milliseconds{quantile=\"0.90\"} %.2f\n", snap.LatencyP90Ms)
		fmt.Fprintf(w, "testudo_jmx_latency_milliseconds{quantile=\"0.95\"} %.2f\n", snap.LatencyP95Ms)
		fmt.Fprintf(w, "testudo_jmx_latency_milliseconds{quantile=\"0.99\"} %.2f\n", snap.LatencyP99Ms)
		fmt.Fprintf(w, "testudo_jmx_latency_milliseconds{quantile=\"1.0\"} %.2f\n\n", snap.LatencyMaxMs)

		if snap.IsKneeDetected {
			fmt.Fprintf(w, "# HELP testudo_jmx_saturation_knee_vus Concurrency level where saturation knee occurred\n")
			fmt.Fprintf(w, "# TYPE testudo_jmx_saturation_knee_vus gauge\n")
			fmt.Fprintf(w, "testudo_jmx_saturation_knee_vus %d\n", snap.SaturationKneeVUs)
		}
	}
}

// InfluxLineFormat serializes a snapshot into InfluxDB / Telegraf Line Protocol.
func InfluxLineFormat(snap engine.MetricSnapshot, scenario string) string {
	return fmt.Sprintf("testudo_jmx,scenario=%s active_vus=%di,target_vus=%di,rps=%.2f,err_pct=%.2f,p50=%.2f,p95=%.2f,p99=%.2f",
		scenario, snap.ActiveVUs, snap.TargetVUs, snap.RequestsPerSec, snap.ErrorRatePct, snap.LatencyP50Ms, snap.LatencyP95Ms, snap.LatencyP99Ms)
}
