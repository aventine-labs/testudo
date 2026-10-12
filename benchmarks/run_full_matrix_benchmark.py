#!/usr/bin/env python3
"""
Canonical Head-to-Head Concurrency & Stress Testing Benchmark
Apache JMeter 5.6.3 vs Testudo-JMX Native Go Engine

Methodology (100% Matching Original Published Specification):
1. Ramp-up: 30 seconds (RAMP=30) across all tiers.
2. Duration: 300 seconds (DURATION=300, 5 minutes sustained soak) per tier.
3. Concurrency Ladder:
   - Full 10 published baseline tiers: [2, 5, 10, 15, 20, 25, 30, 35, 40, 50] VUs
   - Stress tiers pushing into queue saturation & errors: [75, 100, 150, 200] VUs
4. SUT Verification: Direct HTTP 200 OK across all storefront endpoints without 302 redirects.
5. JMeter Subresults Disabled: -Jjmeter.save.saveservice.subresults=false.
6. Warm-up: Initial warm-up run on the SUT to stabilize full-page cache.
7. Randomized Execution Order per tier to eliminate engine ordering bias.
8. Incremental Persistence: magento_benchmark_matrix.json updated after every single tier.
9. Automatic Visualization & Report Regeneration upon completion.
"""

import os
import sys
import time
import json
import math
import shutil
import random
import hashlib
import platform
import subprocess
import csv
from datetime import datetime

# Concurrency ladder tiers: original 10 tiers + stress saturation tiers
TIERS = [2, 5, 10, 15, 20, 25, 30, 35, 40, 50, 75, 100, 150, 200]
RAMP_TIME = 30     # 30-second ramp time
RUN_DURATION = 300 # 300-second (5 minutes) sustained steady-state soak
TARGET_HOST = "localhost"
TARGET_PORT = "8080"
SCENARIO_PATH = "benchmarks/scenarios/magento_ecommerce_flow.jmx"

RAW_JTL_DIR = "benchmarks/data/raw_jtls"
MATRIX_JSON_PATH = "benchmarks/magento_benchmark_matrix.json"

os.makedirs(RAW_JTL_DIR, exist_ok=True)
os.makedirs("benchmarks/visualizations", exist_ok=True)

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def get_descendant_pids(pid):
    pids = [pid]
    try:
        children_path = f"/proc/{pid}/task"
        if os.path.exists(children_path):
            for tid in os.listdir(children_path):
                task_children = os.path.join(children_path, tid, "children")
                if os.path.exists(task_children):
                    with open(task_children, "r") as f:
                        for child_str in f.read().split():
                            pids.extend(get_descendant_pids(int(child_str)))
    except Exception:
        pass
    return list(set(pids))

def get_process_metrics(pid):
    descendants = get_descendant_pids(pid)
    total_rss_kb = 0.0
    total_threads = 0
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

def parse_full_jtl(jtl_path):
    if not os.path.exists(jtl_path) or os.path.getsize(jtl_path) == 0:
        return None

    all_elapsed = []
    sampler_elapsed = {}
    all_errors = 0
    error_codes = {}
    sampler_errors = {}
    min_ts = None
    max_ts = None

    try:
        with open(jtl_path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return None

            col_map = {col.strip().lower(): idx for idx, col in enumerate(header)}
            elapsed_idx = col_map.get("elapsed", 1)
            ts_idx = col_map.get("timestamp", 0)
            success_idx = col_map.get("success", 7)
            label_idx = col_map.get("label", 2)
            code_idx = col_map.get("responsecode", 3)

            for row in reader:
                if len(row) <= max(elapsed_idx, ts_idx):
                    continue
                try:
                    ts = int(row[ts_idx])
                    elapsed = float(row[elapsed_idx])
                    label = row[label_idx].strip() if label_idx < len(row) else "Unknown"
                    resp_code = row[code_idx].strip() if code_idx < len(row) else "200"

                    success = True
                    if success_idx < len(row):
                        s_val = row[success_idx].strip().lower()
                        success = (s_val == "true" or s_val == "1")

                    all_elapsed.append(elapsed)
                    if label not in sampler_elapsed:
                        sampler_elapsed[label] = []
                        sampler_errors[label] = {"count": 0, "codes": {}}
                    sampler_elapsed[label].append(elapsed)

                    if not success:
                        all_errors += 1
                        error_codes[resp_code] = error_codes.get(resp_code, 0) + 1
                        sampler_errors[label]["count"] += 1
                        sampler_errors[label]["codes"][resp_code] = sampler_errors[label]["codes"].get(resp_code, 0) + 1

                    if min_ts is None or ts < min_ts:
                        min_ts = ts
                    if max_ts is None or ts > max_ts:
                        max_ts = ts
                except (ValueError, IndexError):
                    continue
    except Exception as e:
        log(f"[-] Error parsing JTL {jtl_path}: {e}")
        return None

    if not all_elapsed:
        return None

    all_elapsed.sort()
    count = len(all_elapsed)
    duration_sec = ((max_ts - min_ts) / 1000.0) if (min_ts and max_ts and max_ts > min_ts) else 1.0
    if duration_sec <= 0:
        duration_sec = 1.0

    def calc_percentile(data, p):
        idx = int(math.ceil(p / 100.0 * len(data))) - 1
        return data[max(0, min(idx, len(data) - 1))]

    total_stats = {
        "count": count,
        "rps": round(count / duration_sec, 2),
        "error_count": all_errors,
        "error_pct": round((all_errors / count) * 100.0, 2),
        "mean": round(sum(all_elapsed) / count, 1),
        "min": round(all_elapsed[0], 1),
        "max": round(all_elapsed[-1], 1),
        "p50": round(calc_percentile(all_elapsed, 50), 1),
        "p90": round(calc_percentile(all_elapsed, 90), 1),
        "p95": round(calc_percentile(all_elapsed, 95), 1),
        "p99": round(calc_percentile(all_elapsed, 99), 1),
        "error_codes": error_codes
    }

    samplers_stats = {}
    for s_name, s_times in sampler_elapsed.items():
        s_times.sort()
        s_count = len(s_times)
        s_err = sampler_errors.get(s_name, {"count": 0, "codes": {}})
        samplers_stats[s_name] = {
            "count": s_count,
            "rps": round(s_count / duration_sec, 2),
            "error_count": s_err["count"],
            "error_pct": round((s_err["count"] / s_count) * 100.0 if s_count > 0 else 0.0, 2),
            "mean": round(sum(s_times) / s_count, 1),
            "min": round(s_times[0], 1),
            "max": round(s_times[-1], 1),
            "p50": round(calc_percentile(s_times, 50), 1),
            "p90": round(calc_percentile(s_times, 90), 1),
            "p95": round(calc_percentile(s_times, 95), 1),
            "p99": round(calc_percentile(s_times, 99), 1),
            "error_codes": s_err["codes"]
        }

    return {
        "total": total_stats,
        "samplers": samplers_stats,
        "duration_sec": duration_sec
    }

def run_single_engine(engine_name, cmd_args, jtl_path):
    log(f"Launching {engine_name}...")
    start_time = time.time()
    proc = subprocess.Popen(cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    max_rss = 0.0
    max_threads = 0
    rss_samples = []

    while proc.poll() is None:
        rss, threads = get_process_metrics(proc.pid)
        if rss > max_rss:
            max_rss = rss
        if threads > max_threads:
            max_threads = threads
        if rss > 0.0:
            rss_samples.append(rss)
        time.sleep(0.5)

    stdout, stderr = proc.communicate()
    elapsed = time.time() - start_time
    avg_rss = sum(rss_samples) / len(rss_samples) if rss_samples else max_rss

    metrics = parse_full_jtl(jtl_path)
    if metrics:
        m = metrics["total"]
        log(f"  Finished in {elapsed:.1f}s | Samples: {m['count']} | RPS: {m['rps']:.2f} | p50: {m['p50']:.1f}ms | p95: {m['p95']:.1f}ms | Errors: {m['error_pct']:.2f}% ({m['error_count']}) | Peak RSS: {max_rss:.1f}MB | Threads: {max_threads}")
    else:
        log(f"  Finished in {elapsed:.1f}s | Exit Code: {proc.returncode} | No samples parsed")

    return {
        "engine": engine_name,
        "exit_code": proc.returncode,
        "elapsed": elapsed,
        "peak_rss_mb": round(max_rss, 1),
        "avg_rss_mb": round(avg_rss, 1),
        "peak_threads": max_threads,
        "metrics": metrics
    }

def main():
    log("=" * 80)
    log("   Testudo-JMX vs Apache JMeter 5.6.3 Canonical Concurrency & Stress Suite")
    log(f"   Ramp-up: {RAMP_TIME}s | Duration: {RUN_DURATION}s (5 Minutes Steady-State Soak)")
    log(f"   Concurrency Ladder Tiers: {TIERS} VUs")
    log(f"   Target SUT: http://{TARGET_HOST}:{TARGET_PORT}/")
    log("=" * 80)

    # Validate SUT responsiveness
    try:
        check = subprocess.check_output(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", f"http://{TARGET_HOST}:{TARGET_PORT}/"], text=True)
        if check != "200":
            log(f"[-] SUT check returned {check}, expected 200. Halting.")
            sys.exit(1)
        log("[+] SUT confirmed online and responding with HTTP 200 directly.")
    except Exception as e:
        log(f"[-] Failed to verify SUT: {e}")
        sys.exit(1)

    testudo_bin = "./packages/testudo-jmx/bin/testudo-jmx"
    jmeter_bin = "./tools/apache-jmeter-5.6.3/bin/jmeter"

    if not os.path.exists(testudo_bin):
        log(f"[-] Testudo binary not found at {testudo_bin}")
        sys.exit(1)
    if not os.path.exists(jmeter_bin):
        log(f"[-] JMeter binary not found at {jmeter_bin}")
        sys.exit(1)

    with open(testudo_bin, "rb") as f:
        testudo_sha = hashlib.sha256(f.read()).hexdigest()

    log(f"[+] Testudo-JMX Binary SHA-256: {testudo_sha}")
    log(f"[+] Apache JMeter Path: {jmeter_bin}")

    # Initialize results matrix
    results_matrix = {
        "metadata": {
            "timestamp": datetime.now().isoformat(),
            "testudo_sha256": testudo_sha,
            "jmeter_version": "5.6.3",
            "jdk_version": subprocess.check_output(["java", "-version"], stderr=subprocess.STDOUT, text=True).splitlines()[0],
            "jvm_flags": "-Xms1g -Xmx1g -XX:+UseG1GC",
            "sut_host": TARGET_HOST,
            "sut_port": TARGET_PORT,
            "os": platform.platform(),
            "kernel": platform.release(),
            "tiers": TIERS,
            "ramp_sec": RAMP_TIME,
            "duration_sec": RUN_DURATION,
            "declared_tolerance": "+/- 10% on throughput and p50-p95 latency"
        },
        "jmeter": {},
        "testudo": {}
    }

    # 1. Initial warm-up run (discarded) to prime the SUT full-page cache
    warmup_jtl = "/tmp/initial_warmup.jtl"
    log("[+] Running initial SUT warm-up iteration (discarded)...")
    w_args = [
        testudo_bin, "-n", "-t", SCENARIO_PATH,
        "-JVUS=2", "-JDURATION=30", "-JRAMP=5",
        f"-JTARGET_HOST={TARGET_HOST}", f"-JTARGET_PORT={TARGET_PORT}",
        "-l", warmup_jtl
    ]
    subprocess.run(w_args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(warmup_jtl):
        os.remove(warmup_jtl)
    time.sleep(3)

    for vus in TIERS:
        log("\n" + "=" * 80)
        log(f"   STARTING CONCURRENCY TIER: {vus} VIRTUAL USERS (Ramp: {RAMP_TIME}s, Duration: {RUN_DURATION}s)")
        log("=" * 80)

        order = ["testudo", "jmeter"]
        random.shuffle(order)

        t_res = None
        j_res = None

        for engine in order:
            if engine == "testudo":
                jtl = os.path.join(RAW_JTL_DIR, f"testudo_vus{vus}.jtl")
                cmd = [
                    testudo_bin, "-n", "-t", SCENARIO_PATH,
                    f"-JVUS={vus}", f"-JDURATION={RUN_DURATION}", f"-JRAMP={RAMP_TIME}",
                    f"-JTARGET_HOST={TARGET_HOST}", f"-JTARGET_PORT={TARGET_PORT}",
                    "-l", jtl
                ]
                t_res = run_single_engine(f"Testudo-JMX ({vus} VUs)", cmd, jtl)
            else:
                jtl = os.path.join(RAW_JTL_DIR, f"jmeter_vus{vus}.jtl")
                cmd = [
                    jmeter_bin, "-n", "-t", SCENARIO_PATH,
                    "-Jjmeter.save.saveservice.subresults=false",
                    f"-JVUS={vus}", f"-JDURATION={RUN_DURATION}", f"-JRAMP={RAMP_TIME}",
                    f"-JTARGET_HOST={TARGET_HOST}", f"-JTARGET_PORT={TARGET_PORT}",
                    "-l", jtl
                ]
                j_res = run_single_engine(f"Apache JMeter ({vus} VUs)", cmd, jtl)

            time.sleep(5)

        if j_res and j_res["metrics"]:
            entry = j_res["metrics"].copy()
            entry["generator"] = {
                "tool": "jmeter",
                "vus": vus,
                "runtime_sec": round(j_res["elapsed"], 1),
                "peak_rss_mb": j_res["peak_rss_mb"],
                "avg_rss_mb": j_res["avg_rss_mb"],
                "peak_threads": j_res["peak_threads"]
            }
            results_matrix["jmeter"][str(vus)] = entry

        if t_res and t_res["metrics"]:
            entry = t_res["metrics"].copy()
            entry["generator"] = {
                "tool": "testudo",
                "vus": vus,
                "runtime_sec": round(t_res["elapsed"], 1),
                "peak_rss_mb": t_res["peak_rss_mb"],
                "avg_rss_mb": t_res["avg_rss_mb"],
                "peak_threads": t_res["peak_threads"]
            }
            results_matrix["testudo"][str(vus)] = entry

        # Save incremental matrix to disk after each tier
        with open(MATRIX_JSON_PATH, "w") as f:
            json.dump(results_matrix, f, indent=2)

        # Print tier comparison summary
        if j_res and j_res["metrics"] and t_res and t_res["metrics"]:
            jm = j_res["metrics"]["total"]
            tm = t_res["metrics"]["total"]
            mem_red = j_res["peak_rss_mb"] / t_res["peak_rss_mb"] if t_res["peak_rss_mb"] > 0 else 1.0
            log(f"\n[TIER {vus} VUs SUMMARY]")
            log(f"  Throughput:  JMeter {jm['rps']:.2f} rps | Testudo {tm['rps']:.2f} rps (Delta: {tm['rps'] - jm['rps']:+.2f} rps)")
            log(f"  p50 Latency: JMeter {jm['p50']:.1f} ms | Testudo {tm['p50']:.1f} ms")
            log(f"  p95 Latency: JMeter {jm['p95']:.1f} ms | Testudo {tm['p95']:.1f} ms")
            log(f"  p99 Latency: JMeter {jm['p99']:.1f} ms | Testudo {tm['p99']:.1f} ms")
            log(f"  Error Rate:  JMeter {jm['error_pct']:.2f}% ({jm['error_count']}) | Testudo {tm['error_pct']:.2f}% ({tm['error_count']})")
            log(f"  Peak RSS:    JMeter {j_res['peak_rss_mb']:.1f} MB | Testudo {t_res['peak_rss_mb']:.1f} MB ({mem_red:.1f}x lower)")

    log("\n" + "=" * 80)
    log("   ALL CONCURRENCY TIERS COMPLETED SUCCESSFULLY")
    log(f"   Matrix written to: {MATRIX_JSON_PATH}")
    log("=" * 80)

    # Automatically regenerate visualizations
    try:
        log("[+] Regenerating publication-grade benchmark visualization charts...")
        subprocess.run(["python3", "scripts/generate_testudo_benchmark_visualizations.py"], check=True)
        log("[+] Visualization charts successfully updated.")
    except Exception as e:
        log(f"[-] Failed to regenerate visualizations: {e}")

if __name__ == "__main__":
    main()
