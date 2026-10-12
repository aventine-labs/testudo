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

def get_process_rss_mb(pid):
    """Read VmRSS from /proc/<pid>/status on Linux or fallback to ps."""
    try:
        proc_status = f"/proc/{pid}/status"
        if os.path.exists(proc_status):
            with open(proc_status, "r") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        parts = line.split()
                        return float(parts[1]) / 1024.0 # Convert kB to MB
        # Fallback using ps
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)]).decode().strip()
        if out:
            return float(out) / 1024.0
    except Exception:
        pass
    return 0.0

def run_test(engine_name, cmd_args, duration_secs):
    print(f"\n[+] Launching {engine_name}...")
    print(f"    Command: {' '.join(cmd_args)}")

    start_time = time.time()
    proc = subprocess.Popen(cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    max_rss = 0.0
    samples = []

    while proc.poll() is None:
        rss = get_process_rss_mb(proc.pid)
        if rss > max_rss:
            max_rss = rss
        if rss > 0.0:
            samples.append(rss)
        time.sleep(0.5)

    stdout, stderr = proc.communicate()
    elapsed = time.time() - start_time
    avg_rss = sum(samples) / len(samples) if samples else max_rss

    print(f"    Finished in {elapsed:.2f}s | Exit Code: {proc.returncode}")
    print(f"    Peak Resident Memory (VmRSS): {max_rss:.1f} MB")
    print(f"    Average Steady-State Memory:  {avg_rss:.1f} MB")

    return {
        "engine": engine_name,
        "exit_code": proc.returncode,
        "elapsed": elapsed,
        "peak_rss_mb": max_rss,
        "avg_rss_mb": avg_rss
    }

def main():
    parser = argparse.ArgumentParser(description="Replicate JMeter vs Testudo-JMX Benchmark")
    parser.add_argument("--vus", type=int, default=10, help="Number of concurrent Virtual Users (default: 10)")
    parser.add_argument("--duration", type=int, default=30, help="Duration in seconds (default: 30)")
    parser.add_argument("--ramp", type=int, default=5, help="Ramp up time in seconds (default: 5)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Target host (default: 127.0.0.1)")
    parser.add_argument("--port", type=str, default="8080", help="Target port (default: 8080)")
    parser.add_argument("--jmx", type=str, default="benchmarks/scenarios/magento_ecommerce_flow.jmx", help="JMX scenario path")
    args = parser.parse_args()

    if not os.path.exists(args.jmx):
        print(f"[-] Error: Scenario file '{args.jmx}' not found.")
        sys.exit(1)

    print("================================================================================")
    print("   Testudo-JMX Benchmark Replication Suite")
    print(f"   Scenario:    {args.jmx}")
    print(f"   Concurrency: {args.vus} VUs | Duration: {args.duration}s | Target: {args.host}:{args.port}")
    print("================================================================================")

    # 1. Check for Testudo-JMX
    testudo_cmd = None
    if shutil.which("testudo-jmx"):
        testudo_cmd = ["testudo-jmx"]
    elif os.path.exists("./packages/testudo-jmx/bin/testudo-jmx.js"):
        testudo_cmd = ["node", "./packages/testudo-jmx/bin/testudo-jmx.js"]
    elif os.path.exists("./packages/testudo-jmx/bin/platforms/testudo-jmx-linux-amd64"):
        testudo_cmd = ["./packages/testudo-jmx/bin/platforms/testudo-jmx-linux-amd64"]

    # 2. Check for Apache JMeter
    jmeter_cmd = None
    if shutil.which("jmeter"):
        jmeter_cmd = ["jmeter"]
    elif os.path.exists("./tools/apache-jmeter-5.6.3/bin/jmeter"):
        jmeter_cmd = ["./tools/apache-jmeter-5.6.3/bin/jmeter"]

    results = []

    # Run Testudo-JMX
    if testudo_cmd:
        t_args = testudo_cmd + [
            "-n", "-t", args.jmx,
            f"-JVUS={args.vus}",
            f"-JDURATION={args.duration}",
            f"-JRAMP={args.ramp}",
            f"-JTARGET_HOST={args.host}",
            f"-JTARGET_PORT={args.port}",
            "-l", "/tmp/testudo_replicate.jtl"
        ]
        res_t = run_test("Testudo-JMX (Native Go)", t_args, args.duration)
        results.append(res_t)
    else:
        print("[-] Notice: testudo-jmx binary not found in PATH or bin directory.")

    # Run Apache JMeter
    if jmeter_cmd:
        j_args = jmeter_cmd + [
            "-n", "-t", args.jmx,
            f"-JVUS={args.vus}",
            f"-JDURATION={args.duration}",
            f"-JRAMP={args.ramp}",
            f"-JTARGET_HOST={args.host}",
            f"-JTARGET_PORT={args.port}",
            "-l", "/tmp/jmeter_replicate.jtl"
        ]
        res_j = run_test("Apache JMeter (JVM)", j_args, args.duration)
        results.append(res_j)
    else:
        print("[-] Notice: Apache JMeter not found in PATH or tools directory. Skipping JMeter run.")

    # Summary table
    if len(results) == 2:
        res_t, res_j = results[0], results[1]
        reduction = (res_j["peak_rss_mb"] / res_t["peak_rss_mb"]) if res_t["peak_rss_mb"] > 0 else 0
        pct_savings = ((res_j["peak_rss_mb"] - res_t["peak_rss_mb"]) / res_j["peak_rss_mb"] * 100) if res_j["peak_rss_mb"] > 0 else 0

        print("\n================================================================================")
        print("   REPLICATION COMPARATIVE RESULTS")
        print("================================================================================")
        print(f"   Apache JMeter Peak RSS:    {res_j['peak_rss_mb']:.1f} MB")
        print(f"   Testudo-JMX Peak RSS:      {res_t['peak_rss_mb']:.1f} MB")
        print(f"   Memory Density Multiplier: {reduction:.1f}x Lower Memory ({pct_savings:.1f}% reduction)")
        print("================================================================================\n")
    elif len(results) == 1:
        res = results[0]
        print(f"\n[+] Executed {res['engine']} successfully: Peak RSS {res['peak_rss_mb']:.1f} MB.\n")

if __name__ == "__main__":
    main()
