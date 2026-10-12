package jmx

import "time"

// TestPlan represents a normalized, parsed JMeter execution plan.
type TestPlan struct {
	Name            string                 `json:"name"`
	Enabled         bool                   `json:"enabled"`
	UserVariables   map[string]string      `json:"user_variables"`
	ThreadGroups    []*ThreadGroup         `json:"thread_groups"`
	GlobalHeaders   map[string]string      `json:"global_headers"`
	CSVDataSets     []*CSVDataSetConfig    `json:"csv_datasets"`
	KeepAliveMode   KeepAliveGlobalMode    `json:"keep_alive_mode"`
	RawProperties   map[string]string      `json:"raw_properties"`
}

// KeepAliveGlobalMode defines the global override state for connection reuse.
type KeepAliveGlobalMode string

const (
	KeepAliveDefault  KeepAliveGlobalMode = "DEFAULT"   // Follow per-sampler JMX settings
	KeepAliveForceOn  KeepAliveGlobalMode = "FORCE_ON"  // Force Connection: keep-alive
	KeepAliveForceOff KeepAliveGlobalMode = "FORCE_OFF" // Force Connection: close
)

type FlowType string

const (
	FlowTypeSampler   FlowType = "SAMPLER"
	FlowTypePageBreak FlowType = "PAGE_BREAK" // ZebraTester PageBreak / JMeter TransactionController
	FlowTypeLoop      FlowType = "LOOP"       // Inner LoopController
)

// FlowElement represents an execution node in the hierarchical test plan tree.
type FlowElement struct {
	Type                 FlowType       `json:"type"`
	Name                 string         `json:"name"`
	Enabled              bool           `json:"enabled"`
	Sampler              *HTTPSampler   `json:"sampler,omitempty"`
	LoopCount            int            `json:"loop_count,omitempty"`             // For FlowTypeLoop (e.g. 5, or -1)
	LoopCondition        string         `json:"loop_condition,omitempty"`         // Dynamic property/variable expression
	GenerateParentSample bool           `json:"generate_parent_sample,omitempty"` // For FlowTypePageBreak
	Children             []*FlowElement `json:"children,omitempty"`
}

// ThreadGroup represents a virtual user execution pool.
type ThreadGroup struct {
	Name                string            `json:"name"`
	Enabled             bool              `json:"enabled"`
	IsSetUp             bool              `json:"is_setup,omitempty"`
	IsTearDown          bool              `json:"is_teardown,omitempty"`
	NumThreads          int               `json:"num_threads"`
	RampTimeSec         int               `json:"ramp_time_sec"`
	DurationSec         int               `json:"duration_sec"`
	StartupDelaySec     int               `json:"startup_delay_sec,omitempty"`
	LoopCount           int               `json:"loop_count"` // -1 for forever / duration bound
	SameUserOnIteration bool              `json:"same_user_on_iteration"`
	DefaultTimerDelayMs int               `json:"default_timer_delay_ms"`
	DefaultTimerRangeMs int               `json:"default_timer_range_ms"`
	Samplers            []*HTTPSampler    `json:"samplers"` // Flat projection for backwards compatibility
	FlowElements        []*FlowElement    `json:"flow_elements,omitempty"` // Hierarchical tree
	Variables           map[string]string `json:"variables"`
}

// HTTPSampler represents an HTTP/1.1 or HTTP/2 request sampler.
type HTTPSampler struct {
	Name             string               `json:"name"`
	Enabled          bool                 `json:"enabled"`
	Domain           string               `json:"domain"`
	Port             string               `json:"port"`
	Protocol         string               `json:"protocol"` // "http" or "https"
	Path             string               `json:"path"`
	Method           string               `json:"method"` // GET, POST, PUT, DELETE, etc.
	FollowRedirects  bool                 `json:"follow_redirects"`
	UseKeepAlive     bool                 `json:"use_keepalive"`
	Body             string               `json:"body"`
	Headers          map[string]string    `json:"headers"`
	Arguments        []*HTTPArgument      `json:"arguments"`
	ConnectTimeoutMs int                  `json:"connect_timeout_ms"`
	ResponseTimeoutMs int                 `json:"response_timeout_ms"`
	Extractors       []*ExtractorRule     `json:"extractors"`
	Assertions       []*ResponseAssertion `json:"assertions"`
	TimerDelayMs     int                  `json:"timer_delay_ms"`
	TimerRangeMs     int                  `json:"timer_range_ms"`
}

// HTTPArgument represents a query parameter or form field.
type HTTPArgument struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	AlwaysEncode bool `json:"always_encode"`
}

// ExtractorRule represents a dynamic token extractor (Regex, Boundary, or JSONPath).
type ExtractorRule struct {
	Type          ExtractorType `json:"type"`
	RefName       string        `json:"ref_name"`
	Regex         string        `json:"regex,omitempty"`
	Template      string        `json:"template,omitempty"` // e.g. "$1$"
	MatchNo       int           `json:"match_no"`           // 0 for random, 1 for first
	DefaultValue  string        `json:"default_value"`
	LeftBoundary  string        `json:"left_boundary,omitempty"`
	RightBoundary string        `json:"right_boundary,omitempty"`
	JSONPath      string        `json:"json_path,omitempty"`
	ScopeHeaders  bool          `json:"scope_headers"` // true if inspecting headers vs body
}

// ExtractorType identifies the extraction algorithm.
type ExtractorType string

const (
	ExtractorRegex    ExtractorType = "REGEX"
	ExtractorBoundary ExtractorType = "BOUNDARY"
	ExtractorJSON     ExtractorType = "JSON"
)

// ResponseAssertion checks response code or body contents.
type ResponseAssertion struct {
	TestField     string   `json:"test_field"` // "response_code" or "response_data"
	TestType      int      `json:"test_type"`  // 1=Contains, 2=Matches, 8=Equals, 16=Substring
	InvertRule    bool     `json:"invert_rule,omitempty"` // true if NOT / inverse match
	Patterns      []string `json:"patterns"`
	AssumeSuccess bool     `json:"assume_success"`
}

const (
	AssertionContains  = 1
	AssertionMatches   = 2
	AssertionNot       = 4
	AssertionEquals    = 8
	AssertionSubstring = 16
)


// CSVDataSetConfig defines parameterization via external CSV files.
type CSVDataSetConfig struct {
	Filename       string   `json:"filename"`
	VariableNames  []string `json:"variable_names"`
	Delimiter      string   `json:"delimiter"`
	RecycleOnEOF   bool     `json:"recycle_on_eof"`
	StopThreadOnEOF bool    `json:"stop_thread_on_eof"`
}

// ExecutionOptions captures runtime parameters passed via CLI or GUI.
type ExecutionOptions struct {
	PlanFile         string
	JTLFile          string
	ReportDir        string
	Duration         time.Duration
	OverrideVUs      int
	RampRate         int // VUs per second
	KeepAliveMode    KeepAliveGlobalMode
	RecycleOnIter    bool
	PrometheusPort   int
	WebGUIPort       int
	IsHeadless          bool
	AutoStepHunter      bool
	DecomposeRedirects  bool
}
