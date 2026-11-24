/**
 * @aventine/testudo v1.1.0 - Solo Developer Local Cockpit UI Renderer (src/studio-ui.ts)
 * Serves strict CSP-clean HTML & JS (/solo_studio.js, zero inline <script> blocks) for MODE_SOLO_LOCAL (:3850).
 * Combines 5-Lane Waterfall <canvas>, Time-Travel, Opt-In Browser Stress, 1:N Hybrid Canary,
 * AND Unified 10-Language Polyglot Unit + Contract Cassette + Diff Mutation + 1-Click Failure Distiller!
 * Zero external dependencies. Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

export function renderSoloStudioHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Testudo Studio v1.1 - Unified Polyglot Unit, 5-Lane Waterfall &amp; Hybrid Load Cockpit</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; max-width: 100%; overflow-x: hidden; background: #040914; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
    header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px; background: #081226; border-bottom: 1px solid #1e293b; }
    .brand { font-weight: 800; font-size: 15px; color: #38bdf8; letter-spacing: 0.4px; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; font: 700 11px monospace; background: #064e3b; color: #6ee7b7; border: 1px solid #10b981; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, select, input { background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 6px; padding: 7px 12px; font: 600 12px system-ui, sans-serif; }
    button { cursor: pointer; min-height: 28px; min-width: 28px; }
    button.primary { background: #0284c7; border-color: #38bdf8; color: #ffffff; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 14px; padding: 16px; max-width: 100%; }
    .card { background: #081226; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; max-width: 100%; }
    .card.wide { grid-column: 1 / -1; }
    h2 { margin: 0 0 8px 0; font-size: 14px; color: #e2e8f0; }
    .muted { font-size: 12px; color: #cbd5e1; margin: 0 0 10px 0; }
    canvas { display: block; width: 100%; max-width: 100%; height: auto; background: #020617; border: 1px solid #334155; border-radius: 8px; }
    pre { background: #020617; color: #cbd5e1; border: 1px solid #1e293b; border-radius: 6px; padding: 10px; font: 11px/1.45 monospace; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 10px 0 0 0; }
    .filmstrip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .snap-card { background: #020617; border: 1px solid #334155; border-radius: 6px; padding: 6px; width: 180px; cursor: pointer; }
    .snap-card img { width: 100%; height: auto; border-radius: 4px; display: block; }
    .snap-meta { font: 600 10px monospace; color: #94a3b8; margin-top: 4px; }
    .poly-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
  </style>
</head>
<body>
  <header data-testid="solo-studio-header">
    <div>
      <span class="brand" data-testid="solo-studio-title">TESTUDO STUDIO v1.1 (UNIFIED POLYGLOT &amp; E2E LOCAL COCKPIT)</span>
      <span class="pill" data-testid="solo-enclave-badge">SPLIT-WORLD &lt;4KB PROBE + 10-LANG TWEP</span>
    </div>
    <div class="toolbar">
      <label for="solo-stress-toggle" style="font-size:12px;color:#cbd5e1;">Opt-In Stress:</label>
      <select id="solo-stress-toggle" data-testid="solo-stress-toggle" aria-label="Opt-In Browser Stress Mode">
        <option value="false">Disabled (Default Fast QA)</option>
        <option value="true">Enabled (Carousel Cliff + 3-Step GC Leak)</option>
      </select>
      <button class="primary" id="btn-run-polyglot" data-testid="btn-run-polyglot">Run Polyglot Unit + Contracts</button>
      <button class="primary" id="btn-run-waterfall" data-testid="btn-run-waterfall">Run Suite &amp; 5-Lane Waterfall</button>
      <button id="btn-run-hybrid" data-testid="btn-run-hybrid">Run 1:N Hybrid Load + Canary</button>
      <button id="btn-run-advisor" data-testid="btn-run-advisor">Scan AST Edge Cases</button>
    </div>
  </header>

  <main>
    <section class="card wide" data-testid="solo-polyglot-card">
      <h2>0. Bi-Directional 9-Language Polyglot Unit, Contract Cassette &amp; Failure Distiller</h2>
      <p class="muted" id="solo-polyglot-summary" data-testid="solo-polyglot-summary">Unifies TypeScript, Rust, Go, C++20, Java, PHP, Aegis Z3, C# &amp; Ruby with Contract Drift (-9861/-9862) &amp; Hollow Mutation (-9863) gates.</p>
      <div class="poly-bar">
        <label for="solo-distill-lang" style="font-size:12px;color:#cbd5e1;">Distill E2E Failure To:</label>
        <select id="solo-distill-lang" data-testid="solo-distill-lang" aria-label="Target Unit Test Language">
          <option value="typescript">TypeScript</option>
          <option value="rust">Rust</option>
          <option value="go">Go</option>
          <option value="cpp">C++20</option>
          <option value="java">Java 21+</option>
          <option value="php">PHP 8+</option>
          <option value="aegis">Aegis Z3 (.aeg)</option>
          <option value="csharp">C# / .NET</option>
          <option value="ruby">Ruby</option>
        </select>
        <button id="btn-distill-failure" data-testid="btn-distill-failure">Distill Step Failure -&gt; Native Unit Test</button>
      </div>
      <pre id="solo-polyglot-json" data-testid="solo-polyglot-json">{"polyglotReady":true,"languagesSupported":9}</pre>
      <pre id="solo-distilled-code" data-testid="solo-distilled-code">// Select a target language and click "Distill Step Failure" to generate a &lt; 1 ms native unit regression test.</pre>
    </section>

    <section class="card wide" data-testid="solo-waterfall-card">
      <h2>1. Out-of-the-Box 5-Lane Causal Waterfall &amp; Backend Server-Timing Split</h2>
      <p class="muted" id="solo-doctor-summary" data-testid="solo-doctor-summary">Click "Run Suite &amp; 5-Lane Waterfall" to inspect Step -&gt; Network/TTFB -&gt; LongTask/CLS -&gt; DOM/PII -&gt; Bottleneck Doctor.</p>
      <canvas id="solo-waterfall-canvas" data-testid="solo-waterfall-canvas" width="920" height="220"></canvas>
      <pre id="solo-waterfall-json" data-testid="solo-waterfall-json">{"ready":true,"mode":"MODE_SOLO_LOCAL"}</pre>
    </section>

    <section class="card" data-testid="solo-stress-card">
      <h2>2. Opt-In Browser Stress &amp; Time-Travel Inspector</h2>
      <p class="muted">Carousel 1x..125x FPS cliff &amp; Macrotask + 2x GC (10, 25, 50) monotonic slope leak prover.</p>
      <pre id="solo-stress-json" data-testid="solo-stress-json">{"stressEnabled":false}</pre>
    </section>

    <section class="card" data-testid="solo-hybrid-card">
      <h2>3. 1:N Hybrid Wire Load + Real-Browser Canary Overlay</h2>
      <p class="muted">Overlays Real-Browser LCP/INP/Alpha_UX onto Wire RPS &amp; p95 with PII-redacted USL-knee screengrabs.</p>
      <canvas id="solo-hybrid-canvas" data-testid="solo-hybrid-canvas" width="460" height="150"></canvas>
      <div class="filmstrip" id="solo-filmstrip" data-testid="solo-filmstrip"></div>
      <pre id="solo-hybrid-json" data-testid="solo-hybrid-json">{"hybridReady":true}</pre>
    </section>
  </main>

  <script src="/solo_studio.js"></script>
</body>
</html>`;
}

export function renderSoloStudioClientJs(sessionToken: string): string {
  const safeTok = String(sessionToken || '').replace(/[^0-9a-fA-F]/g, '');
  return `(function() {
  const TOKEN = "${safeTok}";
  async function postApi(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
      body: JSON.stringify(body || {})
    });
    return await r.json();
  }

  function drawWaterfall(wf) {
    const c = document.getElementById("solo-waterfall-canvas");
    if (!c || !wf) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, c.width, c.height);
    const total = Math.max(1, wf.totalDurationUs || 1000);
    const scale = (c.width - 170) / total;
    const laneColors = ["#38bdf8", "#10b981", "#f59e0b", "#ef4444", "#a855f7"];
    const laneTitles = ["L1 Steps", "L2 Net+TTFB", "L3 LongTask", "L4 DOM+PII", "L5 Doctor"];
    for (let i = 0; i < 5; i++) {
      const y = 14 + i * 40;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px monospace";
      ctx.fillText(laneTitles[i], 10, y + 16);
      ctx.strokeStyle = "#1e293b";
      ctx.beginPath();
      ctx.moveTo(150, y + 26);
      ctx.lineTo(c.width - 12, y + 26);
      ctx.stroke();
    }
    (wf.lane1Steps || []).forEach((s) => {
      ctx.fillStyle = laneColors[0];
      ctx.fillRect(150 + s.startUs * scale, 16, Math.max(6, s.durationUs * scale), 18);
    });
    (wf.lane2Network || []).forEach((n, idx) => {
      const x = 150 + n.startUs * scale;
      const w = Math.max(8, n.totalUs * scale);
      ctx.fillStyle = laneColors[1];
      ctx.fillRect(x, 54 + (idx % 2) * 9, w, 8);
      if (n.serverTimingSplits && n.serverTimingSplits.length > 0) {
        ctx.fillStyle = "#22d3ee";
        ctx.fillRect(x + w * 0.3, 54 + (idx % 2) * 9, Math.max(3, w * 0.4), 8);
      }
    });
    (wf.lane3MainThread || []).forEach((m) => {
      ctx.fillStyle = laneColors[2];
      ctx.fillRect(150 + m.startUs * scale, 96, Math.max(6, m.durationUs * scale), 16);
    });
    (wf.lane4DomAndSecurity || []).forEach((e) => {
      ctx.fillStyle = e.severity === "critical" ? "#ef4444" : "#eab308";
      ctx.fillRect(150 + e.timestampUs * scale, 136, 8, 16);
    });
    const savingsW = Math.min(c.width - 170, ((wf.lane5Doctor && wf.lane5Doctor.parallelizableSavingsUs) || 0) * scale);
    ctx.fillStyle = laneColors[4];
    ctx.fillRect(150, 176, Math.max(10, savingsW), 16);
  }

  function drawHybridOverlay(rep) {
    const c = document.getElementById("solo-hybrid-canvas");
    const strip = document.getElementById("solo-filmstrip");
    if (!c || !rep || !Array.isArray(rep.stages)) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, c.width, c.height);
    const stages = rep.stages;
    const maxLcp = Math.max(1, ...stages.map((s) => s.browserLcpUs));
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();
    stages.forEach((s, i) => {
      const x = 30 + (i * (c.width - 60)) / Math.max(1, stages.length - 1);
      const y = c.height - 20 - (s.wireP95Us / maxLcp) * (c.height - 40);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#f59e0b";
    ctx.beginPath();
    stages.forEach((s, i) => {
      const x = 30 + (i * (c.width - 60)) / Math.max(1, stages.length - 1);
      const y = c.height - 20 - (s.browserLcpUs / maxLcp) * (c.height - 40);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
    ctx.stroke();

    if (strip) {
      strip.innerHTML = "";
      stages.forEach((s) => {
        const div = document.createElement("div");
        div.className = "snap-card";
        div.setAttribute("data-testid", "snap-" + s.stage);
        const img = document.createElement("img");
        img.src = s.redactedScreengrabDataUri;
        img.alt = s.stage + " screengrab";
        const meta = document.createElement("div");
        meta.className = "snap-meta";
        meta.textContent = s.stage + " | alpha=" + s.uxAmplificationRatio + "x";
        div.appendChild(img);
        div.appendChild(meta);
        strip.appendChild(div);
      });
    }
  }

  document.getElementById("btn-run-polyglot").addEventListener("click", async function() {
    const data = await postApi("/api/studio/run-polyglot", {});
    document.getElementById("solo-polyglot-summary").textContent =
      "Contract Gate: " + data.contractCheck.status +
      " | Mutation Score: " + (data.mutationReport.killScoreBps / 100).toFixed(1) + "%" +
      " | Impacted E2E Slice: " + data.dagPlan.impactedE2eJourneys.length + " (" + data.dagPlan.savedE2eRunsCount + " skipped)";
    document.getElementById("solo-polyglot-json").textContent = JSON.stringify(data, null, 2);
  });

  document.getElementById("btn-distill-failure").addEventListener("click", async function() {
    const lang = document.getElementById("solo-distill-lang").value;
    const data = await postApi("/api/studio/distill-failure", { targetLang: lang });
    document.getElementById("solo-distilled-code").textContent =
      "// File: " + data.distilled.suggestedFilePath + "\\n" + data.distilled.code;
  });

  document.getElementById("btn-run-waterfall").addEventListener("click", async function() {
    const stress = document.getElementById("solo-stress-toggle").value === "true";
    const data = await postApi("/api/studio/run-suite", { stress });
    drawWaterfall(data.waterfall);
    document.getElementById("solo-doctor-summary").textContent =
      "Verdict: " + data.waterfall.lane5Doctor.verdict +
      " | Parallel Savings: " + (data.waterfall.lane5Doctor.parallelizableSavingsUs / 1000).toFixed(2) + " ms" +
      " | N+1 Alerts: " + data.waterfall.lane5Doctor.nPlusOneFindings.length;
    document.getElementById("solo-waterfall-json").textContent = JSON.stringify(data.waterfall.lane5Doctor, null, 2);
    document.getElementById("solo-stress-json").textContent = JSON.stringify({
      cardinality: data.cardinalityStress,
      endurance: data.enduranceStress,
      timeTravelFrames: data.timeTravelFrames.length
    }, null, 2);
  });

  document.getElementById("btn-run-hybrid").addEventListener("click", async function() {
    const data = await postApi("/api/studio/run-hybrid-canary", {});
    drawHybridOverlay(data.hybridReport);
    document.getElementById("solo-hybrid-json").textContent = JSON.stringify({
      peakWireRps: data.hybridReport.peakWireRps,
      uslKneeVus: data.hybridReport.uslKneeVus,
      peakUxAmplificationRatio: data.hybridReport.peakUxAmplificationRatio,
      canaryAllocatedCores: data.hybridReport.canaryAllocatedCores,
      shmRamSpoolActive: data.hybridReport.shmRamSpoolActive
    }, null, 2);
  });

  document.getElementById("btn-run-advisor").addEventListener("click", async function() {
    const data = await postApi("/api/studio/ast-advisor", {});
    document.getElementById("solo-stress-json").textContent = JSON.stringify(data.advisor, null, 2);
  });
})();`;
}
