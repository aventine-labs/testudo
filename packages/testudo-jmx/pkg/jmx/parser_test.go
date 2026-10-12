package jmx_test

import (
	"os"
	"path/filepath"
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

func TestParseJMXFile(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "fixtures", "sample_load_test.jmx")
	plan, err := jmx.ParseJMXFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to parse fixture: %v", err)
	}

	if plan.Name != "Aventine Testudo-JMX Golden Benchmark" {
		t.Errorf("Unexpected plan name: %s", plan.Name)
	}

	if len(plan.ThreadGroups) != 1 {
		t.Fatalf("Expected 1 ThreadGroup, got %d", len(plan.ThreadGroups))
	}

	tg := plan.ThreadGroups[0]
	if tg.NumThreads != 5 {
		t.Errorf("Expected 5 threads, got %d", tg.NumThreads)
	}
	if tg.LoopCount != 5 {
		t.Errorf("Expected loop count 5, got %d", tg.LoopCount)
	}

	if len(tg.Samplers) != 2 {
		t.Fatalf("Expected 2 samplers, got %d", len(tg.Samplers))
	}

	s1 := tg.Samplers[0]
	if s1.Name != "01_Auth_Handshake" {
		t.Errorf("Expected sampler name 01_Auth_Handshake, got %s", s1.Name)
	}
	if s1.Method != "GET" {
		t.Errorf("Expected method GET, got %s", s1.Method)
	}
	if s1.Path != "/api/v1/auth/token" {
		t.Errorf("Expected path /api/v1/auth/token, got %s", s1.Path)
	}
	if len(s1.Extractors) != 1 {
		t.Fatalf("Expected 1 extractor on sampler 1, got %d", len(s1.Extractors))
	}
	ext := s1.Extractors[0]
	if ext.RefName != "AUTH_SESSION_TOKEN" {
		t.Errorf("Expected refname AUTH_SESSION_TOKEN, got %s", ext.RefName)
	}

	s2 := tg.Samplers[1]
	if s2.Name != "02_Authorized_Resource" {
		t.Errorf("Expected sampler name 02_Authorized_Resource, got %s", s2.Name)
	}
	if s2.Method != "POST" {
		t.Errorf("Expected method POST, got %s", s2.Method)
	}
	if s2.TimerDelayMs != 25 {
		t.Errorf("Expected timer delay 25ms, got %d", s2.TimerDelayMs)
	}
	if len(s2.Assertions) != 1 {
		t.Errorf("Expected 1 assertion, got %d", len(s2.Assertions))
	}
}

func TestEvaluator(t *testing.T) {
	vars := map[string]string{
		"BASE_URL": "127.0.0.1",
		"APP_PORT": "8080",
		"TOKEN":    "xyz987",
	}

	template := "http://${BASE_URL}:${APP_PORT}/auth?key=${TOKEN}"
	evaluated := jmx.EvaluateString(template, vars, 1)
	expected := "http://127.0.0.1:8080/auth?key=xyz987"
	if evaluated != expected {
		t.Errorf("Evaluated mismatch: got %s, want %s", evaluated, expected)
	}

	fnTemplate := "Time: ${__time()} Thread: ${__threadNum()}"
	fnEvaluated := jmx.EvaluateString(fnTemplate, vars, 42)
	if !jmxEvaluateContains(fnEvaluated, "Thread: 42") {
		t.Errorf("Expected thread num 42 in evaluation: %s", fnEvaluated)
	}

	unresolvedTemplate := "val: ${NOT_SET} and ${TOKEN}"
	unresolvedEval := jmx.EvaluateString(unresolvedTemplate, vars, 1)
	expectedUnresolved := "val: ${NOT_SET} and xyz987"
	if unresolvedEval != expectedUnresolved {
		t.Errorf("Unresolved eval mismatch: got %s, want %s", unresolvedEval, expectedUnresolved)
	}
}

func jmxEvaluateContains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || (len(s) > 0 && len(sub) > 0 && stringContains(s, sub)))
}

func stringContains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestParsePageBreaksAndLoops(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "fixtures", "pagebreaks_and_loops_flow.jmx")
	plan, err := jmx.ParseJMXFile(fixturePath)
	if err != nil {
		t.Fatalf("Failed to parse fixture: %v", err)
	}

	if len(plan.ThreadGroups) != 1 {
		t.Fatalf("Expected 1 ThreadGroup, got %d", len(plan.ThreadGroups))
	}
	tg := plan.ThreadGroups[0]

	// Check backwards compatibility projection
	if len(tg.Samplers) != 6 {
		t.Fatalf("Expected 6 flat samplers, got %d", len(tg.Samplers))
	}

	// Check hierarchical flow elements
	if len(tg.FlowElements) != 3 {
		t.Fatalf("Expected 3 top-level flow elements, got %d", len(tg.FlowElements))
	}

	// Element 1: PageBreak 01_Catalog_Browse
	fe1 := tg.FlowElements[0]
	if fe1.Type != jmx.FlowTypePageBreak {
		t.Errorf("Expected FlowTypePageBreak, got %s", fe1.Type)
	}
	if fe1.Name != "01_Catalog_Browse" {
		t.Errorf("Expected name 01_Catalog_Browse, got %s", fe1.Name)
	}
	if !fe1.GenerateParentSample {
		t.Errorf("Expected GenerateParentSample to be true")
	}
	if len(fe1.Children) != 2 {
		t.Fatalf("Expected 2 children under 01_Catalog_Browse, got %d", len(fe1.Children))
	}
	if fe1.Children[0].Name != "01_1_Home_Page" || fe1.Children[1].Name != "01_2_Categories" {
		t.Errorf("Unexpected child names: %s, %s", fe1.Children[0].Name, fe1.Children[1].Name)
	}

	// Element 2: Inner Loop Search Loop 3x
	fe2 := tg.FlowElements[1]
	if fe2.Type != jmx.FlowTypeLoop {
		t.Errorf("Expected FlowTypeLoop, got %s", fe2.Type)
	}
	if fe2.Name != "Search Inner Loop 3x" {
		t.Errorf("Expected name Search Inner Loop 3x, got %s", fe2.Name)
	}
	if fe2.LoopCount != 3 {
		t.Errorf("Expected LoopCount 3, got %d", fe2.LoopCount)
	}
	if len(fe2.Children) != 2 {
		t.Fatalf("Expected 2 children under Search Inner Loop, got %d", len(fe2.Children))
	}

	// Validate JSON PostProcessor on search sampler
	searchChild := fe2.Children[0]
	if searchChild.Sampler == nil {
		t.Fatalf("Expected sampler pointer on child 0")
	}
	if len(searchChild.Sampler.Extractors) != 1 {
		t.Fatalf("Expected 1 extractor on search child, got %d", len(searchChild.Sampler.Extractors))
	}
	jsonExt := searchChild.Sampler.Extractors[0]
	if jsonExt.Type != jmx.ExtractorJSON {
		t.Errorf("Expected ExtractorJSON, got %v", jsonExt.Type)
	}
	if jsonExt.RefName != "SEARCH_TOKEN" {
		t.Errorf("Expected refName SEARCH_TOKEN, got %s", jsonExt.RefName)
	}
	if jsonExt.JSONPath != "$.data.token" {
		t.Errorf("Expected JSONPath $.data.token, got %s", jsonExt.JSONPath)
	}
	if jsonExt.DefaultValue != "FALLBACK_TOKEN" {
		t.Errorf("Expected DefaultValue FALLBACK_TOKEN, got %s", jsonExt.DefaultValue)
	}

	// Validate ResponseAssertion on detail sampler
	detailChild := fe2.Children[1]
	if detailChild.Sampler == nil {
		t.Fatalf("Expected sampler pointer on child 1")
	}
	if len(detailChild.Sampler.Assertions) != 1 {
		t.Fatalf("Expected 1 assertion on detail child, got %d", len(detailChild.Sampler.Assertions))
	}
	assertRule := detailChild.Sampler.Assertions[0]
	if !assertRule.InvertRule {
		t.Errorf("Expected InvertRule to be true for NOT assertion")
	}
	if len(assertRule.Patterns) != 1 || assertRule.Patterns[0] != "CRITICAL_ERROR" {
		t.Errorf("Unexpected pattern: %v", assertRule.Patterns)
	}

	// Element 3: PageBreak 03_Checkout_Flow
	fe3 := tg.FlowElements[2]
	if fe3.Type != jmx.FlowTypePageBreak {
		t.Errorf("Expected FlowTypePageBreak, got %s", fe3.Type)
	}
	if fe3.Name != "03_Checkout_Flow" {
		t.Errorf("Expected name 03_Checkout_Flow, got %s", fe3.Name)
	}
	if len(fe3.Children) != 2 {
		t.Fatalf("Expected 2 children under 03_Checkout_Flow, got %d", len(fe3.Children))
	}
}

func TestPropertyInjectionAndEvaluator(t *testing.T) {
	jmx.SetProperty("VUS", "50")
	jmx.SetProperty("TARGET_HOST", "127.0.0.1")

	// 1. Defined property with default fallback
	s1 := jmx.EvaluateString("${__P(VUS, 10)}", nil, 1)
	if s1 != "50" {
		t.Errorf("Expected 50, got %s", s1)
	}

	// 2. Defined property without default
	s2 := jmx.EvaluateString("${__P(TARGET_HOST)}", nil, 1)
	if s2 != "127.0.0.1" {
		t.Errorf("Expected 127.0.0.1, got %s", s2)
	}

	// 3. Undefined property with default fallback
	s3 := jmx.EvaluateString("${__P(UNKNOWN_KEY, fallback_val)}", nil, 1)
	if s3 != "fallback_val" {
		t.Errorf("Expected fallback_val, got %s", s3)
	}

	// 4. Undefined property with single argument (JMeter specification defaults to 1)
	s4 := jmx.EvaluateString("${__P(NON_EXISTENT)}", nil, 1)
	if s4 != "1" {
		t.Errorf("Expected 1, got %s", s4)
	}

	// 5. Alternate alias __property
	s5 := jmx.EvaluateString("${__property(VUS)}", nil, 1)
	if s5 != "50" {
		t.Errorf("Expected 50, got %s", s5)
	}
}

func TestSchedulerAndGaussianTimerParsing(t *testing.T) {
	xmlContent := `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <hashTree>
    <TestPlan testname="Scheduler and Timer Plan" enabled="true">
      <boolProp name="TestPlan.functional_mode">false</boolProp>
    </TestPlan>
    <hashTree>
      <!-- TG 1: scheduler=false, empty duration, loops=-1 -->
      <ThreadGroup testname="UnscheduledTG" enabled="true">
        <stringProp name="ThreadGroup.num_threads">2</stringProp>
        <stringProp name="ThreadGroup.ramp_time">5</stringProp>
        <boolProp name="ThreadGroup.scheduler">false</boolProp>
        <stringProp name="ThreadGroup.duration"></stringProp>
        <stringProp name="LoopController.loops">-1</stringProp>
      </ThreadGroup>
      <hashTree>
        <HTTPSamplerProxy testname="Sampler1" enabled="true">
          <stringProp name="HTTPSampler.domain">127.0.0.1</stringProp>
          <stringProp name="HTTPSampler.path">/test</stringProp>
        </HTTPSamplerProxy>
        <hashTree>
          <GaussianRandomTimer testname="Gaussian Think Time" enabled="true">
            <stringProp name="ConstantTimer.delay">1000</stringProp>
            <stringProp name="RandomTimer.range">500</stringProp>
          </GaussianRandomTimer>
          <hashTree/>
        </hashTree>
      </hashTree>
      <!-- TG 2: scheduler=true, duration=120 -->
      <ThreadGroup testname="ScheduledTG" enabled="true">
        <stringProp name="ThreadGroup.num_threads">5</stringProp>
        <boolProp name="ThreadGroup.scheduler">true</boolProp>
        <stringProp name="ThreadGroup.duration">120</stringProp>
      </ThreadGroup>
      <hashTree/>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`

	tmpFile, err := os.CreateTemp("", "test_sched_*.jmx")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())
	_, _ = tmpFile.WriteString(xmlContent)
	_ = tmpFile.Close()

	plan, err := jmx.ParseJMXFile(tmpFile.Name())
	if err != nil {
		t.Fatalf("ParseJMXFile failed: %v", err)
	}

	if len(plan.ThreadGroups) != 2 {
		t.Fatalf("Expected 2 thread groups, got %d", len(plan.ThreadGroups))
	}

	tg1 := plan.ThreadGroups[0]
	if tg1.Scheduler {
		t.Errorf("Expected tg1.Scheduler=false, got true")
	}
	if tg1.DurationSec != 0 {
		t.Errorf("Expected tg1.DurationSec=0 for unscheduled plan, got %d", tg1.DurationSec)
	}
	if tg1.LoopCount != -1 {
		t.Errorf("Expected tg1.LoopCount=-1, got %d", tg1.LoopCount)
	}
	if len(tg1.Samplers) != 1 {
		t.Fatalf("Expected 1 sampler in tg1, got %d", len(tg1.Samplers))
	}
	s := tg1.Samplers[0]
	if !s.TimerIsGaussian {
		t.Errorf("Expected TimerIsGaussian=true for GaussianRandomTimer")
	}
	if s.TimerDelayMs != 1000 {
		t.Errorf("Expected TimerDelayMs=1000, got %d", s.TimerDelayMs)
	}
	if s.TimerRangeMs != 500 {
		t.Errorf("Expected TimerRangeMs=500, got %d", s.TimerRangeMs)
	}

	tg2 := plan.ThreadGroups[1]
	if !tg2.Scheduler {
		t.Errorf("Expected tg2.Scheduler=true, got false")
	}
	if tg2.DurationSec != 120 {
		t.Errorf("Expected tg2.DurationSec=120, got %d", tg2.DurationSec)
	}
}


