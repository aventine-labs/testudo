package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/enclave"
	"aventinelabs.com/testudo-jmx/pkg/engine"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
	"aventinelabs.com/testudo-jmx/pkg/reporting"
	"aventinelabs.com/testudo-jmx/pkg/web"
	"aventinelabs.com/testudo-jmx/pkg/worker"
)

const Version = "1.0.0"

func main() {
	// JMeter-compatible CLI Flags
	testPlanFile := flag.String("t", "", "Path to JMeter test plan (.jmx or .tjmx)")
	jtlFile := flag.String("l", "", "Path to output JTL execution log (.jtl or .csv)")
	headless := flag.Bool("n", false, "Run in non-GUI (headless CLI) mode")
	generateReport := flag.Bool("e", false, "Generate HTML dashboard report after load test")
	reportDir := flag.String("o", "", "Output directory for HTML dashboard report")
	forceGUI := flag.Bool("g", false, "Launch Web Flight Deck GUI (localhost:3014)")
	guiPort := flag.Int("p", 3014, "Port for Web Flight Deck GUI")
	overrideVUs := flag.Int("u", 0, "Override virtual user count (0 = use JMX plan)")
	durationStr := flag.String("d", "", "Override test duration (e.g. 30s, 5m, 1h)")
	keepAliveStr := flag.String("k", "DEFAULT", "Keep-Alive Mode: DEFAULT | FORCE_ON | FORCE_OFF")
	recycleIter := flag.Bool("recycle", false, "Recycle TCP/TLS connection pool per loop iteration")
	autoHunter := flag.Bool("autohunt", false, "Enable automated step-up saturation knee hunter")
	decomposeRedirects := flag.Bool("subsamples", false, "Decompose redirect chains into discrete sub-samples (-0, -1)")
	correlateOnly := flag.Bool("correlate", false, "Run 1-click RegexForge auto-correlation on plan and exit")
	promPort := flag.Int("prometheus-port", 0, "Port to serve Prometheus /metrics (e.g. 9090)")
	workerMode := flag.Bool("worker", false, "Launch as a headless worker daemon for distributed load execution")
	workerPort := flag.Int("worker-port", 9091, "Port for headless worker daemon (default: 9091)")
	meshTelemetry := flag.String("mesh-telemetry", "", "UDP target endpoint for streaming telemetry (e.g. 127.0.0.1:8210)")
	showVersion := flag.Bool("version", false, "Display Testudo-JMX version")
	showVersionShort := flag.Bool("v", false, "Display Testudo-JMX version")

	flag.Parse()

	if *showVersion || *showVersionShort {
		fmt.Printf("Testudo-JMX™ version %s (Aventine Labs LLC)\n", Version)
		fmt.Println("100% Native Single-Binary Execution Engine for Apache JMeter (.jmx)")
		return
	}

	if *workerMode {
		printBanner()
		fmt.Printf("[WORKER] Launching Testudo-JMX Headless Mesh Leaf Daemon on port :%d...\n", *workerPort)
		fmt.Println("[WORKER] Role: MESH_LEAF | Awaiting directives from Testudo LoadTest / SovereignLoad")
		if *meshTelemetry != "" {
			fmt.Printf("[WORKER] Off-TCP UDP Telemetry Streaming Target: %s\n", *meshTelemetry)
		}
		daemon := worker.NewWorkerDaemon(*workerPort)
		if err := daemon.Start(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("[ERROR] Worker daemon failure: %v\n", err)
			os.Exit(1)
		}
		return
	}

	if *testPlanFile == "" {
		printBanner()
		fmt.Println("Error: Missing test plan argument (-t scenario.jmx).")
		fmt.Println("Run 'testudo-jmx --help' for complete usage instructions.")
		os.Exit(1)
	}

	printBanner()

	// Parse JMX Plan
	fmt.Printf("[INIT] Parsing JMX Test Plan: %s\n", *testPlanFile)
	plan, err := jmx.ParseJMXFile(*testPlanFile)
	if err != nil {
		fmt.Printf("[ERROR] Failed to parse JMX plan: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("[PLAN] Loaded: \"%s\" with %d ThreadGroup(s) and %d Sampler(s)\n",
		plan.Name, len(plan.ThreadGroups), len(plan.ThreadGroups[0].Samplers))

	// Handle 1-click Auto-Correlation flag
	if *correlateOnly {
		fmt.Println("[ENCLAVE] Invoking RegexForge WASM Auto-Correlator...")
		applied := enclave.AutoCorrelatePlan(plan)
		fmt.Printf("[ENCLAVE] Completed: %d dynamic tokens auto-correlated and wired.\n", applied)
		return
	}

	// Execution Options
	var testDuration time.Duration
	if *durationStr != "" {
		d, err := time.ParseDuration(*durationStr)
		if err == nil {
			testDuration = d
		}
	} else if len(plan.ThreadGroups) > 0 && plan.ThreadGroups[0].DurationSec > 0 {
		testDuration = time.Duration(plan.ThreadGroups[0].DurationSec) * time.Second
	}

	kaMode := jmx.KeepAliveGlobalMode(*keepAliveStr)

	opts := jmx.ExecutionOptions{
		PlanFile:       *testPlanFile,
		JTLFile:        *jtlFile,
		ReportDir:      *reportDir,
		Duration:       testDuration,
		OverrideVUs:    *overrideVUs,
		KeepAliveMode:  kaMode,
		RecycleOnIter:  *recycleIter,
		WebGUIPort:         *guiPort,
		IsHeadless:         *headless,
		AutoStepHunter:     *autoHunter,
		DecomposeRedirects: *decomposeRedirects,
	}

	driver := engine.NewDriver(plan, opts)

	// Setup Prometheus Endpoint if configured
	if *promPort > 0 {
		go func() {
			http.HandleFunc("/metrics", reporting.PrometheusHandler(driver.Collector))
			fmt.Printf("[TELEMETRY] Prometheus /metrics listening on http://0.0.0.0:%d/metrics\n", *promPort)
			_ = http.ListenAndServe(fmt.Sprintf(":%d", *promPort), nil)
		}()
	}

	// Setup JTL Writer if specified
	var jtlWriter *reporting.JTLWriter
	if *jtlFile != "" {
		w, err := reporting.NewJTLWriter(*jtlFile)
		if err != nil {
			fmt.Printf("[WARN] Failed to open JTL file: %v\n", err)
		} else {
			jtlWriter = w
			fmt.Printf("[JTL] Logging sample execution logs to: %s\n", *jtlFile)
			go func() {
				for sample := range driver.ResultChan {
					_ = jtlWriter.WriteSample(sample, "VirtualUser", int(driver.Collector.Snapshot().ActiveVUs))
				}
			}()
		}
	}

	// Setup Web Flight Deck GUI if requested or non-headless
	var webServer *web.Server
	if *forceGUI || !*headless {
		webServer = web.NewServer(driver, *guiPort)
		if err := webServer.Start(); err != nil {
			fmt.Printf("[WARN] Failed to start Web Flight Deck: %v\n", err)
		} else {
			fmt.Printf("[COCKPIT] Web Flight Deck V2 active at: http://localhost:%d\n", *guiPort)
		}
	}

	// Signal interception for graceful interrupt
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("\n[INTERRUPT] Graceful shutdown initiated. Draining worker goroutines...")
		cancel()
	}()

	// Console progress ticker in headless mode
	if *headless {
		go func() {
			t := time.NewTicker(2 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					snap := driver.Collector.Snapshot()
					fmt.Printf("[PROGRESS] VUs: %3d | RPS: %7.1f | Err: %5.2f%% | p50: %5.1fms | p95: %5.1fms | p99: %5.1fms\n",
						snap.ActiveVUs, snap.RequestsPerSec, snap.ErrorRatePct, snap.LatencyP50Ms, snap.LatencyP95Ms, snap.LatencyP99Ms)
				}
			}
		}()
	}

	fmt.Printf("[RUN] Test started. Duration: %v | Keep-Alive: %s | Recycle Iterations: %v\n",
		testDuration, kaMode, *recycleIter)

	runErr := driver.Run(ctx)
	if runErr != nil && runErr != context.Canceled {
		fmt.Printf("[ERROR] Run execution error: %v\n", runErr)
	}

	// Test Completion Summary
	snap := driver.Collector.Snapshot()
	fmt.Println("\n=======================================================")
	fmt.Println("             TESTUDO-JMX EXECUTION SUMMARY             ")
	fmt.Println("=======================================================")
	fmt.Printf("Total Completed Requests: %d\n", snap.TotalRequests)
	fmt.Printf("Successful Requests:      %d\n", snap.SuccessRequests)
	fmt.Printf("Failed Requests:          %d (%.2f%%)\n", snap.FailedRequests, snap.ErrorRatePct)
	fmt.Printf("Average Throughput:       %.1f req/sec\n", snap.RequestsPerSec)
	fmt.Printf("Latency Percentiles:      p50: %.1fms | p90: %.1fms | p95: %.1fms | p99: %.1fms | Max: %.1fms\n",
		snap.LatencyP50Ms, snap.LatencyP90Ms, snap.LatencyP95Ms, snap.LatencyP99Ms, snap.LatencyMaxMs)
	if snap.IsKneeDetected {
		fmt.Printf("Saturation Knee Detected: %d Concurrent VUs\n", snap.SaturationKneeVUs)
	}
	fmt.Println("=======================================================")

	if jtlWriter != nil {
		_ = jtlWriter.Close()
	}

	// Generate static HTML report if requested
	if *generateReport && *reportDir != "" {
		fmt.Printf("[REPORT] Generating HTML Dashboard in: %s\n", *reportDir)
		err := reporting.GenerateStaticDashboard(*reportDir, snap, plan.Name)
		if err != nil {
			fmt.Printf("[WARN] Failed to write HTML report: %v\n", err)
		} else {
			fmt.Printf("[REPORT] HTML Dashboard ready at %s/index.html\n", *reportDir)
		}
	}

	if webServer != nil {
		_ = webServer.Stop()
	}
}

func printBanner() {
	fmt.Print(`
  _____         _             _         _ __  ____  __
 |_   _|__  ___| |_ _   _  __| | ___   | |\ \/ /\ \/ /
   | |/ _ \/ __| __| | | |/ _` + "`" + ` |/ _ \  | | \  /  \  / 
   | |  __/\__ \ |_| |_| | (_| | (_) |_| | /  \  /  \ 
   |_|\___||___/\__|\__,_|\__,_|\___/(___)_/_/\_\/_/\_\
   Native Execution Engine for Apache JMeter™ (Free Open-Source)
   Aventine Labs LLC • https://aventinelabs.com
`)
}
