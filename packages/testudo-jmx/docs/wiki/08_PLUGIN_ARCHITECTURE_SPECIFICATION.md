# Testudo-JMX™ Plugin Architecture Specification (v0.7.4)
### Extensible Load Testing Runtime Architecture, Capability Isolation, and Multi-Tier Plugin Lifecycle

**Author**: Aventine Labs LLC  
**Date**: October 2026  
**Status**: APPROVED / RFC v0.7.4 (Addressing Forensic Review #13: Strict Unconditional Predecessor Barrier for Diagnostic Generations, Token-Isolated Retiring Exporter Lifecycle Accounting, and Precise Diagnostic Queue Saturation Contract)  
**Target Runtime**: `@aventine/testudo-jmx` v1.1.0+  
**Strict Rule**: Zero em-dashes and zero en-dashes across all code, tests, and documentation.

---

## 1. Executive Summary & Design Mandates

Testudo-JMX is a high-density native Go execution runtime for Apache JMeter test plans. To evolve from a drop-in JMeter replacement into an open load-generation ecosystem without compromising sub-microsecond latency, memory efficiency, or engine correctness, Testudo-JMX adopts a formal two-tier plugin architecture.

### The Three Architectural Invariants
1. **Core Engine Primacy**: The core execution engine (`pkg/engine`, `pkg/transport`, `pkg/reporting`) must remain fully functional and 100% self-contained without plugins. Plugins extend capabilities; they never become a prerequisite for engine performance or correctness.
2. **Zero Internal Exposure**: Internal structs (`FlowElement` AST IR, `Collector` 16-shard reservoirs, `TransportPool`, `Driver` worker synchronization, `transport.SampleResult`) are strictly hidden from plugin authors. Plugins interact exclusively through a dedicated public SDK package (`pkg/plugin`).
3. **Tri-Partite Failure Isolation**: Plugin defects (panics, memory leaks, hangs) must never corrupt load test telemetry or be misattributed to the application under test (AUT).

---

## 2. Rejection of Go's Native Shared Object (`plugin.Open`) Model

Testudo-JMX explicitly rejects Go's standard library `plugin` package (`plugin.Open` / `.so` dynamic loading) based on fatal production constraints:

1. **Non-Portability on Windows**: Go's native plugin implementation fails with `ErrNotSupported` on Windows. Testudo-JMX must compile and distribute as a turnkey single binary across Linux, macOS, and Windows.
2. **Compiler and Version Pinning**: Native Go plugins require identical compiler toolchains, matching build flags, and byte-for-byte identical transitive dependencies. Distributing independently compiled `.so` files across arbitrary user environments is fragile and unmaintainable.
3. **Fatal Shared Memory Domain**: Any unhandled panic or segmentation fault in a shared library immediately kills the entire host process.

---

## 3. Two-Tier Plugin Execution Topology & Failure Isolation Model

```text
                           Testudo-JMX Core Engine
                                      │
                         Plugin Lifecycle & Registry
                                      │
                   ┌──────────────────┴──────────────────┐
                   │                                     │
         Tier 1: Native In-Tree               Tier 2: Isolated Subprocess
           (High-RPS Hot Path)                 (Third-Party / Multi-Lang)
                   │                                     │
            Direct Go Calls                       IPC / Domain Socket
      (gRPC, WebSocket, MQTT, TCP)          (Custom Auth, OTel, Splunk)
                   │                                     │
          < 1ns Dispatch Overhead               Asynchronous / Batched
         Best-Effort Containment                Process-Level Isolation
```

### Tier 1: Native In-Tree Extensions (Hot Path)
* **Target Domains**: High-frequency protocol samplers (gRPC, WebSocket, MQTT, AMQP, Raw TCP), custom streaming assertions, and mathematical timers.
* **Execution Path**: Directly compiled into the Testudo binary or registered at build time via Go interfaces.
* **Performance Profile**: Direct memory calls, sub-nanosecond interface dispatch overhead (measured 0.88 ns/op in `BenchmarkPlugin_PureInterfaceDispatch`), zero allocation on hot path.
* **Failure Guarantee (Best-Effort Fault Containment & Asynchronous Diagnostic Isolation)**:
  * Every native invocation is guarded by `defer recover()` via `SafeExecuteSampler()`, `SafeEvaluateAssertion()`, `SafeFlushBatch()`, and `SafeExportMetrics()` to convert standard Go panics into isolated failures.
  * Public error messages and results are strictly sanitized (`"Plugin <ID> encountered an unexpected runtime failure"`). Raw panic values (`r`), heap pointers, and stack traces are excluded from public `SampleError` and returned `error` objects to prevent credential or PII leaks in customer-facing dashboards or JTL files.
  * **Asynchronous Diagnostic Queue (Finding SDK-01 Remediated)**: Low-level crash diagnostics are routed to an internal asynchronous bounded queue (`chan PanicDiagnostic`, capacity 1024) processed on a dedicated background worker. If a diagnostic callback is slow, it drops non-blocking and increments drop counters rather than stalling load generator execution threads. Panics originating within user-registered diagnostic handlers are caught inside an isolated recovery boundary, preventing diagnostic failures from escaping into engine loops.
  * **Privilege & Confidentiality Warning**: Raw panic values and stack traces may contain internal memory addresses or environment variables. Diagnostic handlers are opt-in, disabled by default, and must be treated as privileged internal sinks.
  * **Explicit Non-Guarantees**: In-process Go code cannot intercept fatal Go runtime traps (e.g. concurrent map read and map write fatal error, stack overflow `runtime.abort`, direct `os.Exit`, or CGo/unsafe memory corruption), cannot prevent unbounded memory leaks leading to host OS OOM kills, and cannot preempt a non-yielding CPU spinloop without context checks.

### Tier 2: Isolated Process Plugins (Cold Path & Batched Sinks)
* **Target Domains**: Custom enterprise authentication (OAuth2 token exchanges, hardware token signing), dynamic synthetic test data generators, and downstream reporting/observability sinks (Splunk, OpenTelemetry, Datadog, Prometheus push).
* **Execution Path**: Runs as an independent child process communicating over Unix Domain Sockets (Linux/macOS) or Named Pipes (Windows).
* **Hot-Path Prohibition**: Isolated plugins are strictly forbidden from synchronous per-request execution. Reporting and metrics plugins receive asynchronous micro-batches off the primary worker thread loop.
* **Failure Guarantee (Process-Level Failure Isolation)**:
  * Completely decoupled OS process boundary.
  * Memory corruption, unhandled panics, hard segmentation faults, or OOM crashes in a Tier 2 subprocess terminate only the child worker.
  * If a remote APM sink like Splunk stalls or becomes unreachable, the bounded queue drops exporter records with explicit accounting without applying backpressure to the primary load generation loop.

---

## 4. Capability-Scoped Public Interfaces (`pkg/plugin`)

To prevent internal API coupling, third-party plugins import solely the public SDK package (`aventinelabs.com/testudo-jmx/pkg/plugin`). Internal transport packages (`pkg/transport`) are never exposed:

```go
package plugin

import (
    "context"
    "sync"
)

// ErrorKind categorizes plugin and execution failure modes to maintain scientific telemetry fidelity.
type ErrorKind string

const (
    // ErrorKindTargetFailure indicates the Application Under Test (AUT) failed (HTTP 5xx, TCP RST, timeout).
    ErrorKindTargetFailure ErrorKind = "TARGET_FAILURE"

    // ErrorKindPluginFailure indicates the plugin itself failed (unhandled panic, syntax error, configuration error).
    ErrorKindPluginFailure ErrorKind = "PLUGIN_FAILURE"

    // ErrorKindHostInfraError indicates the host client machine suffered local resource exhaustion (socket exhaustion, ENOMEM).
    ErrorKindHostInfraError ErrorKind = "HOST_INFRA_ERROR"
)

// SampleError provides structured error metadata distinguishing target AUT defects from plugin faults.
// Sensitive panic values and debug traces are strictly excluded to prevent credential leakage into public telemetry.
type SampleError struct {
    Kind    ErrorKind `json:"kind"`
    Code    string    `json:"code"`
    Message string    `json:"message"` // Public sanitized error message safe for JTL/dashboards
}

// PanicDiagnostic captures internal debugging details when a plugin panics.
// It is intentionally decoupled from public SampleResult and error objects to prevent credential leakage.
type PanicDiagnostic struct {
    PluginID    string `json:"plugin_id"`
    PluginType  string `json:"plugin_type"`
    PanicValue  any    `json:"panic_value"`
    StackTrace  string `json:"stack_trace"`
    TimestampMs int64  `json:"timestamp_ms"`
}

// DiagnosticHandler receives low-level panic telemetry without exposing it to public result streams.
type DiagnosticHandler func(diag PanicDiagnostic)

// SampleResult represents the standardized public execution result emitted by sampler plugins.
type SampleResult struct {
    Label           string            `json:"label"`
    Target          string            `json:"target"`
    Protocol        string            `json:"protocol"`
    StatusCode      int               `json:"status_code"`
    ResponseMessage string            `json:"response_message"`
    Success         bool              `json:"success"`
    TimestampMs     int64             `json:"timestamp_ms"`
    ElapsedUs       int64             `json:"elapsed_us"`
    ConnectUs       int64             `json:"connect_us"`
    LatencyUs       int64             `json:"latency_us"`
    BytesSent       int64             `json:"bytes_sent"`
    BytesReceived   int64             `json:"bytes_received"`
    ThreadName      string            `json:"thread_name"`
    ResponseBody    string            `json:"response_body,omitempty"`
    Metadata        map[string]string `json:"metadata,omitempty"`
    Error           *SampleError      `json:"error,omitempty"`
}

// SessionCapability defines the contract for accessing virtual user session state.
type SessionCapability interface {
    GetVariable(key string) string
    SetVariable(key, val string)
    ThreadID() int
    Iteration() int
}

// CallScopedSession wraps SessionCapability and enforces strict invocation-scoped lifetime.
// Read-write locks synchronize capability access and invalidation, eliminating concurrency races.
type CallScopedSession struct {
    inner   SessionCapability
    mu      sync.RWMutex
    expired bool
}

// SamplerPlugin executes protocol transactions (Tier 1 native or Tier 2 proxy).
type SamplerPlugin interface {
    ID() string
    Execute(ctx context.Context, session SessionCapability, config map[string]string) (*SampleResult, error)
}

// AssertionOutcome represents deterministic assertion verification.
type AssertionOutcome struct {
    Success        bool   `json:"success"`
    FailureMessage string `json:"failure_message,omitempty"`
}

// AssertionPlugin evaluates responses for validity.
type AssertionPlugin interface {
    ID() string
    Evaluate(res *SampleResult, pattern string) AssertionOutcome
}

// ReporterPlugin streams per-sample telemetry batches to external APM sinks.
type ReporterPlugin interface {
    ID() string
    FlushBatch(ctx context.Context, batch []*SampleResult) error
    Close() error
}

// MetricsBatch provides pre-aggregated telemetry windows for high-throughput APM exporters.
type MetricsBatch struct {
    // Window metadata & gap detection
    WindowSequence uint64 `json:"window_sequence"` // Monotonically increasing sequence number to detect missing telemetry windows
    DroppedWindows uint64 `json:"dropped_windows"` // Count of telemetry windows dropped due to exporter backpressure or saturation
    WindowStartMs  int64  `json:"window_start_ms"`
    WindowEndMs    int64  `json:"window_end_ms"`

    // Window-local metrics (rates and counts local to this specific measurement window)
    WindowRequests uint64  `json:"window_requests"` // Total requests completed within this window
    WindowFailures uint64  `json:"window_failures"` // Total failed requests within this window
    BytesSent      uint64  `json:"bytes_sent"`      // Total bytes sent within this window
    BytesReceived  uint64  `json:"bytes_received"`  // Total bytes received within this window
    RPS            float64 `json:"rps"`             // Window-local requests per second

    // Cumulative engine metrics (monotonically increasing across entire test lifecycle)
    CumulativeRequests uint64 `json:"cumulative_requests"` // Total requests completed since test initiation
    CumulativeFailures uint64 `json:"cumulative_failures"` // Total failed requests since test initiation

    // Latency percentiles for this window (microseconds)
    P50Us int64 `json:"p50_us"`
    P90Us int64 `json:"p90_us"`
    P95Us int64 `json:"p95_us"`
    P99Us int64 `json:"p99_us"`
}

// MetricsExporterPlugin streams aggregated metrics windows (e.g. Splunk, OpenTelemetry).
type MetricsExporterPlugin interface {
    ID() string
    ExportMetrics(ctx context.Context, batch *MetricsBatch) error
    Close() error
}
```

### 4.1 SessionCapability Ownership & Concurrency Enforcement
1. **Invocation Lifetime (Call-Scoped)**: A `SessionCapability` instance is valid strictly for the synchronous duration of the `Execute()` or `Evaluate()` call.
2. **Synchronized Invalidation via RWMutex**: The host engine wraps the session in a `CallScopedSession`. When `Execute()` returns, `Invalidate()` acquires a write lock, ensuring all in-flight operations finish before marking the wrapper expired. All subsequent capability operations acquire a read lock, detect expiration, and safely return default empty/zero values.
3. **Comprehensive Expiration**: Expiration applies uniformly across all capability operations: `GetVariable()`, `SetVariable()`, `ThreadID()`, and `Iteration()`.
4. **Prohibition on Retainment**: Plugins must NOT store references to `SessionCapability` across calls, nor persist it in global variables or struct fields.
5. **Thread-Confinement**: State mutation (`SetVariable`) is strictly confined to the calling Virtual User thread's local dictionary, preventing cross-thread race conditions.

### 4.2 Observability & APM Exporter Plugin Contract (Splunk / OpenTelemetry)
High-throughput load tests generating 1M+ requests per second cannot afford to allocate and stream individual request pointers to third-party APM services.
* **Aggregate Metrics Batching**: `MetricsExporterPlugin` receives pre-computed windows (`MetricsBatch`) containing request counts, failure counts, network volume, and p50-p99 percentiles calculated by the 16-shard collector.
* **Window Gap Detection & Drop Accounting**: Every `MetricsBatch` carries a monotonically increasing `WindowSequence` number and a cumulative `DroppedWindows` counter. Downstream systems can deterministically detect lost windows when an external sink experiences temporary saturation.
* **Clear Semantic Separation**: Window-local metrics (`WindowRequests`, `WindowFailures`, `RPS`, `BytesSent`, `BytesReceived`, and window percentiles) are cleanly separated from cumulative lifecycle totals (`CumulativeRequests`, `CumulativeFailures`), preventing rate distortion and aggregation bugs.
* **Non-Blocking Delivery**: Exporters run asynchronously off a bounded ring buffer. If the downstream Splunk or Datadog collector slows down or drops connections, exporter records are dropped with logged drop counters, ensuring zero latency impact on the load generator.

---

## 5. Tri-Partite Failure Taxonomy

Metrics must maintain scientific fidelity. If a third-party plugin fails, it must never distort the error rate of the target system:

```text
Sample Result Outcome
├── TargetFailure: AUT returned HTTP 5xx, TCP RST, or timed out.
│   └── Metric Impact: Counted in FailedRequests and ErrorRatePct.
├── PluginFailure: Plugin panicked, returned syntax error, or exceeded internal timeout.
│   └── Metric Impact: Counted in PluginErrorCount; excluded from AUT ErrorRatePct.
└── HostInfraError: Client machine suffered local ENOMEM, ephemeral port exhaustion, or socket limit.
    └── Metric Impact: Counted in HostSaturationCount; triggers test warning.
```

---

## 6. JMX XML Tag Aliasing & Compatibility Boundaries

Testudo-JMX does not run Java bytecode. Instead, popular JMeter third-party plugins (e.g. `kg.apc.jmeter.samplers.DummySampler`) are supported via clean-room XML tag aliasing:

```go
// Tag registry translates legacy JMeter XML classes to native Testudo plugins
var tagRegistry = map[string]string{
    "kg.apc.jmeter.samplers.DummySampler": "dummy-sampler",
    "com.googlecode.jmeter.plugins.webdriver.sampler.WebDriverSampler": "webdriver-sampler",
}
```

### Compatibility Boundary Notice
* XML tag aliasing maps recognized legacy tags to verified native implementations.
* It explicitly does **not** guarantee semantic equivalence for unmapped or arbitrary custom Java plugins.
* Any legacy `.jmx` referencing an unmapped third-party tag produces a clear diagnostic warning at parse time rather than silent misexecution.

---

## 7. Versioned Manifest Schema & Credential Masking

Each plugin provides a versioned JSON manifest declaring its configuration fields:

```json
{
  "$schema": "https://aventinelabs.com/schemas/testudo-plugin-v1.json",
  "schema_version": "1.0.0",
  "id": "grpc-sampler",
  "version": "1.0.0",
  "name": "gRPC Request Sampler",
  "type": "SAMPLER",
  "fields": [
    { "name": "endpoint", "type": "string", "label": "Target Host:Port", "required": true },
    { "name": "service", "type": "string", "label": "Proto Service", "required": true },
    { "name": "method", "type": "string", "label": "RPC Method", "required": true },
    { "name": "auth_token", "type": "string", "label": "Bearer Token", "required": false, "secret": true },
    { "name": "payload", "type": "json", "label": "Payload (JSON)", "required": false }
  ]
}
```

### Manifest Immutability & Defensive Masking
1. **Registry Immutability**: All registered manifests are deep-cloned upon registration and deep-cloned upon retrieval via `GetManifest()` or `ListManifests()`. External callers cannot mutate registry state.
2. **Identity & Category Validation**: The registry strictly enforces that `manifest.ID == plugin.ID()`, preventing competing identifiers between runtime dispatch and UI display. The declared manifest type must match the registration category (`SAMPLER`, `ASSERTION`, `REPORTER`, `EXPORTER`).
3. **Global ID Collision Prevention**: Duplicate IDs are rejected across all categories (samplers, assertions, reporters, exporters).
4. **Defensive Config Copying**: `MaskSecrets()` always returns an independent defensive copy of the configuration map. Sensitive fields designated with `"secret": true` are masked as `********` when returned via inspection endpoints or logs.

---

## 7.5 Phase 2: Asynchronous Metrics Dispatcher & Multi-Exporter Isolation Architecture

```text
                        Testudo Core Engine (pkg/engine)
                                  |
                      Driver snapTicker (500ms Window)
                                  |
                      MetricsDispatcher.PublishMetrics()
                       (Defensive copy snapshot, <8ns)
                                  |
                  +---------------+---------------+
                  |                               |
        Worker A Queue (Bounded)        Worker B Queue (Bounded)
                  |                               |
           Splunk Exporter               OpenTelemetry Exporter
            (Slow / Stalled)                   (Healthy)
                  |                               |
          Drops window 8                   Receives window 8
        (Drop count incremented)           (100% delivered)
                  |                               |
          Bounded Shutdown                 Normal Flush
        (Abandon stall, no hang)         (Complete delivery)
```

### The Eight Architectural Guarantees (RFC v0.7.2)

1. **Non-Blocking Engine Ingestion & Serialized Publication Order (RFC v0.7.2)**:
   * Sequence assignment and worker queue ingress are serialized under a dedicated publication mutex (`pubMu`). Batch sequence N is guaranteed to be assigned and inserted into all registered worker queues before sequence N+1 can be assigned or enqueued. This eliminates out-of-order queue insertion across concurrent publishers and ensures sequence-ordered worker ingress.
   * `PublishMetrics(batch)` returns immediately without blocking on exporter execution or network I/O.
2. **Immutable Publication Boundary**: `PublishMetrics` defensively clones the incoming batch once at the boundary (`snapshot := batch.Clone()`). Subsequent mutations by the producer cannot corrupt exporter telemetry streams or trigger race detector failures.
3. **Strict Monotonic Sequence Assignment & Fail-Closed Saturation (RFC v0.7.2)**:
   * Sequence numbers are assigned via a Compare-And-Swap (CAS) monotonic barrier (`assignMonotonicSeq`). Sequences never regress backward.
   * If sequence space reaches `math.MaxUint64`, `assignMonotonicSeq` returns `(0, false)` to fail closed without reusing sequences, preserving 100% strict sequence uniqueness.
4. **Atomic Dequeue-to-Active State Transitions (RFC v0.7.2)**:
   * Channel publication and pending sequence ledger registration are synchronized atomically under `worker.seqMu.Lock()`.
   * When dequeuing a batch, the worker sets `currentExportSeq` while still holding `worker.seqMu.Lock()` before removing the sequence from `pendingSeqs`.
   * In `exportSafely`, the defer sets `lastProcessedSeq` and clears `currentExportSeq` atomically under `worker.seqMu.Lock()`.
   * `DrainThrough()` inspects `lastProcessedSeq`, `currentExportSeq`, and `pendingSeqs` under `worker.seqMu.Lock()`. An observer never observes a transient untracked interval where a sequence is neither pending, active, nor completed.
5. **Immediate Shutdown Publication & Registration Cutoff (RFC v0.7.2)**:
   * `CloseWithTimeout()` sets `closing = true` immediately. Both `PublishMetrics()` and `RegisterExporter()` reject new work as soon as `closing || closed` is true, preventing late registrations or orphaned publications after shutdown starts.
6. **Strict Inter-Exporter Isolation & Mathematical Reconciliation Invariants**:
   * Each exporter operates with its own independent bounded channel and dedicated worker goroutine. Saturated queues drop windows strictly for that individual exporter without delaying healthy peer exporters.
   * For every completed or drained run, the accounting invariants hold exactly:
     * `PublishedWindows == stats.AcceptedWindows + stats.QueueDroppedWindows`
     * `stats.AcceptedWindows == stats.DeliveredWindows + stats.ExportFailedWindows + stats.PanicFailedWindows`
     * `stats.TotalFailedWindows == stats.QueueDroppedWindows + stats.ExportFailedWindows + stats.PanicFailedWindows`
   * `stats.LifecyclePanics` captures panics occurring during lifecycle calls (such as `Close()`) independently without inflating `PanicFailedWindows`.
7. **Strict Non-Extending Shutdown Deadline & Concurrent Coordination**:
   * `stop(timeout)` budgets worker exit wait (75%) and plugin close wait strictly within the requested timeout. It NEVER extends shutdown past the caller deadline.
   * Concurrent and sequential calls to `CloseWithTimeout()` coordinate via a completion channel (`closeDoneCh`), guaranteeing that callers waiting for completion observe the exact same completed shutdown outcome without returning premature `nil`.
8. **Serialized Diagnostic Lifecycle & Deadlock Immunity (RFC v0.7.2)**:
   * Diagnostic handler replacements in `setHandler()` are serialized via `lifecycleMu`, guaranteeing deterministic replacement order under concurrent callers.
   * Callback-initiated replacement detects worker context via call-stack inspection and bypasses blocking joins on `oldDoneCh`, preventing self-deadlock when a diagnostic handler calls `SetDiagnosticHandler()`.

### Production Engine Telemetry Integration & Deterministic Saturation
The dispatcher is directly integrated into the execution runtime:
* `Driver.Dispatcher` is wired into `pkg/engine/driver.go`.
* Every 500ms, the engine background ticker computes delta requests, byte throughput, error rate, and p50-p99 latency percentiles, publishing a populated `*plugin.MetricsBatch`.
* Upon test plan completion, the background ticker is cleanly joined and the final delta window is published.
* Outstanding telemetry windows are drained via `d.Dispatcher.Drain(2 * time.Second)`.
* Turnkey CLI execution in `cmd/testudo-jmx/main.go` registers all configured exporters via `plugin.NewConfiguredDispatcher()` and performs clean shutdown upon termination.
* Deterministic backpressure saturation is verified under `TestEngine_TelemetryDispatcher_EndToEndIntegration` (slow exporter with tiny queue forces nonzero queue drops while fast exporter receives all windows with zero drops and lossless request counts).

---

## 8. Reconciled Dual Benchmark Gates

To guarantee zero regression on the core engine while validating plugin efficiency, Testudo-JMX enforces two independent benchmark gates:

| Gate | Target Path | Benchmark Metric | Acceptance Ceiling |
| :--- | :--- | :--- | :--- |
| **Gate A: Core Zero-Regression** | Standard HTTP execution step (Plugins Idle / Disabled) | `BenchmarkDriver_HTTPStep` | < 0.5% delta vs baseline, 0 allocations added |
| **Gate B: Native Plugin Dispatch** | Direct interface invocation (Plugins Active) | `BenchmarkPlugin_PureInterfaceDispatch` | <= 15 ns/op, 0 allocations on hot path (measured: 0.88 ns/op) |

---

## 9. Evidence Pipeline Hardening & Durability Policy

To satisfy strict forensic auditability standards, Testudo's reporting engine distinguishes two evidence persistence levels:

1. **File-Complete (Standard Default)**:
   * Main JTL and microsecond precision sidecar are buffered via `bufio.Writer` and flushed every 250 records.
   * Both header writes perform symmetrical flush and error verification (`w.Flush()` + `w.Error()`).
   * `Close()` propagates all write and flush errors from both CSV writers and both underlying files.
   * Benchmarked throughput: **254.68 MB/s (1.91M samples/sec)** with 100% on-disk row count verification across both output files.
2. **Crash-Durable (Explicit Sync)**:
   * Calls `JTLWriter.Sync()`, invoking `file.Sync()` across both file descriptors to commit data past OS page caches to physical non-volatile storage.

---

## 10. Implementation Roadmap

| Phase | Milestone | Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Architecture RFC v0.4 & Public SDK** | Hardened SDK, synchronized capability revocation, sanitized errors, diagnostic channel, sequenced metrics batch, manifest immutability | **COMPLETED** |
| **Phase 2** | **Asynchronous Metrics Dispatcher & Multi-Exporter Isolation** | Bounded telemetry queues, per-exporter drop accounting, multi-exporter isolation, and panic containment | **COMPLETED** |
| **Phase 2.5**| **Dispatcher Hardening & Engine Integration (RFC v0.6)** | Bounded shutdown, diagnostic deadlock fix, immutable batch copy, sequence drain semantics, and end-to-end engine wiring | **COMPLETED** |
| **Phase 2.6**| **Dispatcher Correctness & Reconciliation (RFC v0.7)** | Monotonic CAS, terminal drain ledger, mathematical accounting invariants, single deadline, final window guarantee, saturation verification | **COMPLETED** |
| **Phase 2.7**| **Dispatcher Concurrency & Lifecycle Hardening (RFC v0.7.1)** | Atomic pending registration, generation-scoped diagnostic completion flush, concurrent close coordination, strict deadline enforcement | **COMPLETED** |
| **Phase 2.8**| **Dispatcher Boundary & Lifecycle Invariants (RFC v0.7.2)** | Serialized publication order (pubMu), atomic dequeue-to-active visibility, immediate shutdown cutoff, serialized diagnostic lifecycle, fail-closed sequence saturation | **COMPLETED** |
| **Phase 2.9**| **Diagnostic Lifecycle & Drain Membership (RFC v0.7.3)** | Deadlock-free concurrent callback replacement, generation-scoped diagnostic completion isolation, and unregister exporter drain membership | **COMPLETED** |
| **Phase 2.10**| **Generation Barrier & Retiring Exporter Accounting (RFC v0.7.4)** | Unconditional predecessor barrier for diagnostic generations, token-isolated retiring exporter tracking, duplicate retiring ID protection, and precise diagnostic queue saturation contract | **COMPLETED** |
| **Phase 3** | **Reference Exporters (Splunk & OpenTelemetry)** | Production Splunk HEC and OpenTelemetry gRPC / OTLP exporters exercised under load | Next Milestone |
| **Phase 4** | **IPC Subprocess Daemon & Out-of-Process Isolation** | Tier 2 background process manager with domain socket IPC | Backlog |
| **Phase 5** | **Flight Deck GUI Forms** | Dynamic manifest-driven configuration form renderer | Backlog |
