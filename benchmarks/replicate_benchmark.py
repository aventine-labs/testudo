#!/usr/bin/env python3
"""
Testudo-JMX vs Apache JMeter Benchmark Replication Script
Open-Source Silicon Efficiency & Parity Verification

Usage:
  python3 benchmarks/replicate_benchmark.py --vus 10 --duration 30 --host 127.0.0.1 --port 8080
"""

import os
import sys
import time
import argparse
import subprocess
import shutil
import random
import csv
import math
import re

def get_descendant_pids(pid):
    """Find all descendant child PIDs recursively."""
    pids = [pid]
    try:
        children_path = f"/proc/{pid}/task"
        if os.path.exists(children_path):
            for tid in os.listdir(children_path):
                task_children = os.path.join(children_path, tid, "children")
                if os.path.exists(task_children):
                    with open(task_children, "r") as f:
                        for child_str in f.read().split():
                            child_pid = int(child_str)
                            pids.extend(get_descendant_pids(child_pid))
    except Exception:
        pass
    return list(set(pids))

def get_process_metrics(pid):
    """Read VmRSS (MB) and active OS thread count from /proc/<pid>/status."""
    descendants = get_descendant_pids(pid)
    total_rss_kb = 0.0
    total_threads = 0

    # If this is a Node wrapper running a Go binary child, prioritize the Go child
    go_child_rss_kb = 0.0
    go_child_threads = 0
    found_go_child = False

    for p in descendants:
        try:
            status_path = f"/proc/{p}/status"
            cmdline_path = f"/proc/{p}/cmdline"
            if not os.path.exists(status_path):
                continue

            rss_kb = 0.0
            threads = 0
            with open(status_path, "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        rss_kb = float(line.split()[1])
                    elif line.startswith("Threads:"):
                        threads = int(line.split()[1])

            is_go_child = False
            if os.path.exists(cmdline_path):
                with open(cmdline_path, "rb") as f:
                    cmd = f.read().decode("latin-1", errors="ignore")
                    if "testudo-jmx" in cmd and "node" not in cmd:
                        is_go_child = True

            if is_go_child:
                found_go_child = True
                go_child_rss_kb = rss_kb
                go_child_threads = threads

            total_rss_kb += rss_kb
            total_threads += threads
        except Exception:
            pass

    if found_go_child and go_child_rss_kb > 0:
        return go_child_rss_kb / 1024.0, go_child_threads

    return total_rss_kb / 1024.0, total_threads

def parse_jtl_metrics(jtl_path):
    """Parse JTL CSV file to compute total requests, throughput, percentiles, and error rate."""
    if not os.path.exists(jtl_path) or os.path.getsize(jtl_path) == 0:
        return None

    elapsed_list = []
    error_count = 0
    min_ts = None
    max_ts = None

    try:
        with open(jtl_path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return None

            # Standard JMeter header: timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect
            col_map = {col.strip().lower(): idx for idx, col in enumerate(header)}
            elapsed_idx = col_map.get("elapsed", 1)
            ts_idx = col_map.get("timestamp", 0)
            success_idx = col_map.get("success", 7)
            label_idx = col_map.get("label", 2)

            for row in reader:
                if len(row) <= max(elapsed_idx, ts_idx):
                    continue
                # Subresults are disabled via -Jjmeter.save.saveservice.subresults=false
                # at execution time, avoiding broad label regex drops
                try:
                    ts = int(row[ts_idx])
                    elapsed = float(row[elapsed_idx])
                    success = True
                    if success_idx < len(row):
                        s_val = row[success_idx].strip().lower()
                        success = (s_val == "true" or s_val == "1")

                    elapsed_list.append(elapsed)
                    if not success:
                        error_count += 1

                    if min_ts is None or ts < min_ts:
                        min_ts = ts
                    if max_ts is None or ts > max_ts:
                        max_ts = ts
                except (ValueError, IndexError):
                    continue
    except Exception as e:
        print(f"[-] Warning parsing JTL {jtl_path}: {e}")
        return None

    if not elapsed_list:
        return None

    elapsed_list.sort()
    count = len(elapsed_list)
    duration_sec = ((max_ts - min_ts) / 1000.0) if (min_ts and max_ts and max_ts > min_ts) else 1.0
    if duration_sec <= 0:
        duration_sec = 1.0

    rps = count / duration_sec
    err_rate = (error_count / count) * 100.0

    def percentile(p):
        idx = int(math.ceil(p / 100.0 * count)) - 1
        idx = max(0, min(idx, count - 1))
        return elapsed_list[idx]

    return {
        "samples": count,
        "duration_sec": duration_sec,
        "rps": rps,
        "error_pct": err_rate,
        "mean_ms": sum(elapsed_list) / count,
        "p50_ms": percentile(50),
        "p90_ms": percentile(90),
        "p95_ms": percentile(95),
        "p99_ms": percentile(99),
        "max_ms": elapsed_list[-1],
    }

def run_test(engine_name, cmd_args, jtl_out_path):
    print(f"\n[+] Launching {engine_name}...")
    print(f"    Command: {' '.join(cmd_args)}")

    start_time = time.time()
    proc = subprocess.Popen(cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    max_rss = 0.0
    max_threads = 0
    samples = []

    while proc.poll() is None:
        rss, threads = get_process_metrics(proc.pid)
        if rss > max_rss:
            max_rss = rss
        if threads > max_threads:
            max_threads = threads
        if rss > 0.0:
            samples.append(rss)
        time.sleep(0.5)

    stdout, stderr = proc.communicate()
    elapsed = time.time() - start_time
    avg_rss = sum(samples) / len(samples) if samples else max_rss

    metrics = parse_jtl_metrics(jtl_out_path)

    print(f"    Finished in {elapsed:.2f}s | Exit Code: {proc.returncode}")
    print(f"    Peak Resident Memory (VmRSS): {max_rss:.1f} MB | Peak OS Threads: {max_threads}")
    if metrics:
        print(f"    Samples: {metrics['samples']} | Throughput: {metrics['rps']:.2f} req/s | p95: {metrics['p95_ms']:.1f} ms | Errors: {metrics['error_pct']:.2f}%")

    return {
        "engine": engine_name,
        "exit_code": proc.returncode,
        "elapsed": elapsed,
        "peak_rss_mb": max_rss,
        "avg_rss_mb": avg_rss,
        "peak_threads": max_threads,
        "metrics": metrics
    }

def main():
    parser = argparse.ArgumentParser(description="Replicate JMeter vs Testudo-JMX Benchmark")
    parser.add_argument("--vus", type=int, default=10, help="Number of concurrent Virtual Users (default: 10)")
    parser.add_argument("--duration", type=int, default=30, help="Duration in seconds (default: 30)")
    parser.add_argument("--ramp", type=int, default=5, help="Ramp up time in seconds (default: 5)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Target host (default: 127.0.0.1)")
    parser.add_argument("--port", type=str, default="8080", help="Target port (default: 8080)")
    parser.add_argument("--jmx", type=str, default="benchmarks/scenarios/magento_ecommerce_flow.jmx", help="JMX scenario path")
    parser.add_argument("--randomize-order", action="store_true", help="Randomize execution order of engines to eliminate cache bias")
    args = parser.parse_args()

    if not os.path.exists(args.jmx):
        print(f"[-] Error: Scenario file '{args.jmx}' not found.")
        sys.exit(1)

    print("================================================================================")
    print("   Testudo-JMX Benchmark Replication Suite")
    print(f"   Scenario:    {args.jmx}")
    print(f"   Concurrency: {args.vus} VUs | Duration: {args.duration}s | Target: {args.host}:{args.port}")
    print("================================================================================")

    # 1. Locate Testudo-JMX binary
    testudo_cmd = None
    if shutil.which("testudo-jmx"):
        testudo_cmd = ["testudo-jmx"]
    elif os.path.exists("./packages/testudo-jmx/bin/testudo-jmx"):
        testudo_cmd = ["./packages/testudo-jmx/bin/testudo-jmx"]
    elif os.path.exists("./packages/testudo-jmx/bin/platforms/testudo-jmx-linux-amd64"):
        testudo_cmd = ["./packages/testudo-jmx/bin/platforms/testudo-jmx-linux-amd64"]
    elif os.path.exists("./packages/testudo-jmx/bin/testudo-jmx.js"):
        testudo_cmd = ["node", "./packages/testudo-jmx/bin/testudo-jmx.js"]

    # 2. Locate Apache JMeter
    jmeter_cmd = None
    if shutil.which("jmeter"):
        jmeter_cmd = ["jmeter"]
    elif os.path.exists("./tools/apache-jmeter-5.6.3/bin/jmeter"):
        jmeter_cmd = ["./tools/apache-jmeter-5.6.3/bin/jmeter"]

    t_jtl = "/tmp/testudo_replicate.jtl"
    j_jtl = "/tmp/jmeter_replicate.jtl"

    # Clean previous runs
    for p in [t_jtl, j_jtl]:
        if os.path.exists(p):
            os.remove(p)

    runners = []
    if testudo_cmd:
        t_args = testudo_cmd + [
            "-n", "-t", args.jmx,
            f"-JVUS={args.vus}",
            f"-JDURATION={args.duration}",
            f"-JRAMP={args.ramp}",
            f"-JTARGET_HOST={args.host}",
            f"-JTARGET_PORT={args.port}",
            "-l", t_jtl
        ]
        runners.append(("Testudo-JMX (Native Go)", t_args, t_jtl))
    else:
        print("[-] Notice: testudo-jmx binary not found in PATH or bin directory.")

    if jmeter_cmd:
        j_args = jmeter_cmd + [
            "-n", "-t", args.jmx,
            "-Jjmeter.save.saveservice.subresults=false",
            f"-JVUS={args.vus}",
            f"-JDURATION={args.duration}",
            f"-JRAMP={args.ramp}",
            f"-JTARGET_HOST={args.host}",
            f"-JTARGET_PORT={args.port}",
            "-l", j_jtl
        ]
        runners.append(("Apache JMeter (JVM)", j_args, j_jtl))
    else:
        print("[-] Notice: Apache JMeter not found in PATH or tools directory. Skipping JMeter run.")

    if args.randomize_order and len(runners) > 1:
        random.shuffle(runners)

    results = {}
    for name, cmd, jtl in runners:
        res = run_test(name, cmd, jtl)
        results[name] = res

    # Comparison Matrix Table
    if "Testudo-JMX (Native Go)" in results and "Apache JMeter (JVM)" in results:
        t_res = results["Testudo-JMX (Native Go)"]
        j_res = results["Apache JMeter (JVM)"]

        mem_reduction = (j_res["peak_rss_mb"] / t_res["peak_rss_mb"]) if t_res["peak_rss_mb"] > 0 else 0
        thread_reduction = (j_res["peak_threads"] / t_res["peak_threads"]) if t_res["peak_threads"] > 0 else 0

        print("\n================================================================================")
        print("   REPLICATION COMPARATIVE RESULTS MATRIX")
        print("================================================================================")
        print(f"{'Metric':<25} | {'Apache JMeter (JVM)':<20} | {'Testudo-JMX (Native Go)':<23} | {'Comparison'}")
        print("-" * 88)
        print(f"{'Peak RSS Memory':<25} | {j_res['peak_rss_mb']:<17.1f} MB | {t_res['peak_rss_mb']:<20.1f} MB | {mem_reduction:.1f}x lower memory")
        print(f"{'Peak OS Threads':<25} | {j_res['peak_threads']:<20} | {t_res['peak_threads']:<23} | {thread_reduction:.1f}x fewer threads")

        if t_res["metrics"] and j_res["metrics"]:
            tm, jm = t_res["metrics"], j_res["metrics"]
            rps_delta = tm["rps"] - jm["rps"]
            print(f"{'Throughput':<25} | {jm['rps']:<15.2f} req/s | {tm['rps']:<17.2f} req/s | Delta: {rps_delta:+.2f} req/s")
            print(f"{'p50 Latency':<25} | {jm['p50_ms']:<17.1f} ms | {tm['p50_ms']:<20.1f} ms | Delta: {tm['p50_ms'] - jm['p50_ms']:+.1f} ms")
            print(f"{'p95 Latency':<25} | {jm['p95_ms']:<17.1f} ms | {tm['p95_ms']:<20.1f} ms | Delta: {tm['p95_ms'] - jm['p95_ms']:+.1f} ms")
            print(f"{'p99 Latency':<25} | {jm['p99_ms']:<17.1f} ms | {tm['p99_ms']:<20.1f} ms | Delta: {tm['p99_ms'] - jm['p99_ms']:+.1f} ms")
            print(f"{'Error Rate':<25} | {jm['error_pct']:<17.2f} %  | {tm['error_pct']:<20.2f} %  | Delta: {tm['error_pct'] - jm['error_pct']:+.2f} %")
        print("================================================================================\n")
    elif len(results) == 1:
        name = list(results.keys())[0]
        res = results[name]
        print(f"\n[+] Executed {name} successfully: Peak RSS {res['peak_rss_mb']:.1f} MB, Threads: {res['peak_threads']}.\n")

if __name__ == "__main__":
    main()
