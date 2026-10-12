package jmx

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

// RawProperty holds string, int, or bool props from JMX XML.
type RawProperty struct {
	XMLName xml.Name
	Name    string `xml:"name,attr"`
	Value   string `xml:",chardata"`
}

// RawElementNode represents a generic XML element in the JMX tree.
type RawElementNode struct {
	XMLName     xml.Name
	GUILass     string            `xml:"guiclass,attr"`
	TestClass   string            `xml:"testclass,attr"`
	TestName    string            `xml:"testname,attr"`
	Enabled     string            `xml:"enabled,attr"`
	ElementType string            `xml:"elementType,attr"`
	Properties  []RawProperty     `xml:",any"`
	InnerNodes  []*RawElementNode `xml:"elementProp"`
	Collections []RawCollection   `xml:"collectionProp"`
}

// RawCollection holds collectionProp elements (e.g. headers or arguments).
type RawCollection struct {
	Name     string            `xml:"name,attr"`
	Elements []*RawElementNode `xml:"elementProp"`
}

// ParseJMXFile reads a .jmx or .tjmx file from disk and parses it into a TestPlan.
func ParseJMXFile(filePath string) (*TestPlan, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read JMX file %s: %w", filePath, err)
	}
	return ParseJMXBytes(data)
}

// ParseJMXBytes parses XML byte contents into a TestPlan.
func ParseJMXBytes(data []byte) (*TestPlan, error) {
	decoder := xml.NewDecoder(bytes.NewReader(data))

	plan := &TestPlan{
		Name:          "Testudo Native JMX Plan",
		Enabled:       true,
		UserVariables: make(map[string]string),
		ThreadGroups:  make([]*ThreadGroup, 0),
		GlobalHeaders: make(map[string]string),
		CSVDataSets:   make([]*CSVDataSetConfig, 0),
		KeepAliveMode: KeepAliveDefault,
		RawProperties: make(map[string]string),
	}

	var currentTG *ThreadGroup
	var currentSampler *HTTPSampler

	type containerFrame struct {
		element   *FlowElement
		exitDepth int
	}
	var containerStack []containerFrame
	var pendingContainer *FlowElement
	hashTreeDepth := 0

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("xml decoding error: %w", err)
		}

		switch elem := token.(type) {
		case xml.StartElement:
			if elem.Name.Local == "hashTree" {
				hashTreeDepth++
				if pendingContainer != nil {
					containerStack = append(containerStack, containerFrame{
						element:   pendingContainer,
						exitDepth: hashTreeDepth,
					})
					pendingContainer = nil
				}
			}

			switch elem.Name.Local {
			case "TestPlan":
				for _, attr := range elem.Attr {
					if attr.Name.Local == "testname" && attr.Value != "" {
						plan.Name = attr.Value
					}
				}
				parseTestPlanProperties(decoder, plan)

			case "ThreadGroup", "SetupThreadGroup", "PostThreadGroup":
				tg := &ThreadGroup{
					Name:                "Thread Group",
					Enabled:             true,
					IsSetUp:             (elem.Name.Local == "SetupThreadGroup"),
					IsTearDown:          (elem.Name.Local == "PostThreadGroup"),
					NumThreads:          1,
					RampTimeSec:         1,
					DurationSec:         60,
					LoopCount:           1,
					SameUserOnIteration: true,
					Samplers:            make([]*HTTPSampler, 0),
					FlowElements:        make([]*FlowElement, 0),
					Variables:           make(map[string]string),
				}
				for _, attr := range elem.Attr {
					if attr.Name.Local == "testname" && attr.Value != "" {
						tg.Name = attr.Value
					}
					if attr.Name.Local == "enabled" {
						tg.Enabled = (attr.Value == "true")
					}
				}
				parseThreadGroupProperties(decoder, tg)
				plan.ThreadGroups = append(plan.ThreadGroups, tg)
				currentTG = tg

			case "TransactionController", "PageBreak":
				name := "Page Break"
				for _, attr := range elem.Attr {
					if attr.Name.Local == "testname" && attr.Value != "" {
						name = attr.Value
					}
				}
				enabled := true
				for _, attr := range elem.Attr {
					if attr.Name.Local == "enabled" {
						enabled = (attr.Value == "true")
					}
				}
				flowElem := &FlowElement{
					Type:                 FlowTypePageBreak,
					Name:                 name,
					Enabled:              enabled,
					GenerateParentSample: true,
					Children:             make([]*FlowElement, 0),
				}
				parseTransactionControllerProperties(decoder, flowElem)

				if len(containerStack) > 0 {
					parent := containerStack[len(containerStack)-1].element
					parent.Children = append(parent.Children, flowElem)
				} else if currentTG != nil {
					currentTG.FlowElements = append(currentTG.FlowElements, flowElem)
				}
				pendingContainer = flowElem

			case "LoopController":
				// If encountered inside thread group hierarchy, this is an inner LoopController
				name := "Loop Controller"
				for _, attr := range elem.Attr {
					if attr.Name.Local == "testname" && attr.Value != "" {
						name = attr.Value
					}
				}
				enabled := true
				for _, attr := range elem.Attr {
					if attr.Name.Local == "enabled" {
						enabled = (attr.Value == "true")
					}
				}
				flowElem := &FlowElement{
					Type:     FlowTypeLoop,
					Name:     name,
					Enabled:  enabled,
					Children: make([]*FlowElement, 0),
				}
				parseInnerLoopControllerProperties(decoder, flowElem)

				if len(containerStack) > 0 {
					parent := containerStack[len(containerStack)-1].element
					parent.Children = append(parent.Children, flowElem)
				} else if currentTG != nil {
					currentTG.FlowElements = append(currentTG.FlowElements, flowElem)
				}
				pendingContainer = flowElem

			case "HTTPSamplerProxy":
				sampler := &HTTPSampler{
					Name:              "HTTP Request",
					Enabled:           true,
					Domain:            "localhost",
					Port:              "80",
					Protocol:          "http",
					Path:              "/",
					Method:            "GET",
					FollowRedirects:   true,
					UseKeepAlive:      true,
					Headers:           make(map[string]string),
					Arguments:         make([]*HTTPArgument, 0),
					Extractors:        make([]*ExtractorRule, 0),
					Assertions:        make([]*ResponseAssertion, 0),
					ConnectTimeoutMs:  10000,
					ResponseTimeoutMs: 30000,
				}
				for _, attr := range elem.Attr {
					if attr.Name.Local == "testname" && attr.Value != "" {
						sampler.Name = attr.Value
					}
					if attr.Name.Local == "enabled" {
						sampler.Enabled = (attr.Value == "true")
					}
				}
				parseSamplerProperties(decoder, sampler)
				if currentTG != nil {
					currentTG.Samplers = append(currentTG.Samplers, sampler)
				}
				currentSampler = sampler

				flowElem := &FlowElement{
					Type:    FlowTypeSampler,
					Name:    sampler.Name,
					Enabled: sampler.Enabled,
					Sampler: sampler,
				}
				if len(containerStack) > 0 {
					parent := containerStack[len(containerStack)-1].element
					parent.Children = append(parent.Children, flowElem)
				} else if currentTG != nil {
					currentTG.FlowElements = append(currentTG.FlowElements, flowElem)
				}

			case "HeaderManager":
				headers := parseHeaderManager(decoder)
				if currentSampler != nil {
					for k, v := range headers {
						currentSampler.Headers[k] = v
					}
				} else {
					for k, v := range headers {
						plan.GlobalHeaders[k] = v
					}
				}

			case "RegexExtractor":
				extractor := parseRegexExtractor(decoder)
				if currentSampler != nil && extractor != nil {
					currentSampler.Extractors = append(currentSampler.Extractors, extractor)
				}

			case "BoundaryExtractor":
				extractor := parseBoundaryExtractor(decoder)
				if currentSampler != nil && extractor != nil {
					currentSampler.Extractors = append(currentSampler.Extractors, extractor)
				}

			case "JSONPostProcessor":
				extractor := parseJSONPostProcessor(decoder)
				if currentSampler != nil && extractor != nil {
					currentSampler.Extractors = append(currentSampler.Extractors, extractor)
				}

			case "ResponseAssertion":
				assertion := parseResponseAssertion(decoder)
				if currentSampler != nil && assertion != nil {
					currentSampler.Assertions = append(currentSampler.Assertions, assertion)
				}

			case "CSVDataSet":
				csvCfg := parseCSVDataSet(decoder)
				if csvCfg != nil {
					plan.CSVDataSets = append(plan.CSVDataSets, csvCfg)
				}

			case "ConstantTimer":
				delay := parseConstantTimer(decoder)
				if currentSampler != nil {
					currentSampler.TimerDelayMs = delay
				} else if currentTG != nil {
					currentTG.DefaultTimerDelayMs = delay
				}

			case "UniformRandomTimer", "GaussianRandomTimer":
				delay, rng := parseUniformRandomTimer(decoder)
				if currentSampler != nil {
					currentSampler.TimerDelayMs = delay
					currentSampler.TimerRangeMs = rng
				} else if currentTG != nil {
					currentTG.DefaultTimerDelayMs = delay
					currentTG.DefaultTimerRangeMs = rng
				}
			}

		case xml.EndElement:
			if elem.Name.Local == "hashTree" {
				if len(containerStack) > 0 && containerStack[len(containerStack)-1].exitDepth == hashTreeDepth {
					containerStack = containerStack[:len(containerStack)-1]
				}
				hashTreeDepth--
			}
		}
	}

	// Default fallback thread group if plan has samplers but no ThreadGroup
	if len(plan.ThreadGroups) == 0 {
		plan.ThreadGroups = append(plan.ThreadGroups, &ThreadGroup{
			Name:        "Default Thread Group",
			Enabled:     true,
			NumThreads:  1,
			RampTimeSec: 1,
			LoopCount:   1,
			Samplers:    make([]*HTTPSampler, 0),
			FlowElements: make([]*FlowElement, 0),
			Variables:   make(map[string]string),
		})
	}

	// Project flat samplers to FlowElements if no container elements were declared
	for _, tg := range plan.ThreadGroups {
		if len(tg.FlowElements) == 0 && len(tg.Samplers) > 0 {
			for _, s := range tg.Samplers {
				tg.FlowElements = append(tg.FlowElements, &FlowElement{
					Type:    FlowTypeSampler,
					Name:    s.Name,
					Enabled: s.Enabled,
					Sampler: s,
				})
			}
		}
	}

	// Apply thread group default timers to samplers without explicit timers
	for _, tg := range plan.ThreadGroups {
		if tg.DefaultTimerDelayMs > 0 || tg.DefaultTimerRangeMs > 0 {
			for _, s := range tg.Samplers {
				if s.TimerDelayMs == 0 && s.TimerRangeMs == 0 {
					s.TimerDelayMs = tg.DefaultTimerDelayMs
					s.TimerRangeMs = tg.DefaultTimerRangeMs
				}
			}
		}
	}

	return plan, nil
}

func parseTestPlanProperties(decoder *xml.Decoder, plan *TestPlan) {
	depth := 1
	var currentArgName string

	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			return
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				plan.RawProperties[propName] = val
				if propName == "Argument.name" {
					currentArgName = val
				} else if propName == "Argument.value" && currentArgName != "" {
					plan.UserVariables[currentArgName] = val
					currentArgName = ""
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
}

func parseThreadGroupProperties(decoder *xml.Decoder, tg *ThreadGroup) {
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			return
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "ThreadGroup.num_threads":
					if n, err := strconv.Atoi(resolvePropertyDefault(val)); err == nil {
						tg.NumThreads = n
					}
				case "ThreadGroup.ramp_time":
					if n, err := strconv.Atoi(resolvePropertyDefault(val)); err == nil {
						tg.RampTimeSec = n
					}
				case "ThreadGroup.duration":
					if n, err := strconv.Atoi(resolvePropertyDefault(val)); err == nil {
						tg.DurationSec = n
					}
				case "ThreadGroup.delay":
					if n, err := strconv.Atoi(resolvePropertyDefault(val)); err == nil {
						tg.StartupDelaySec = n
					}
				case "LoopController.loops":
					if n, err := strconv.Atoi(resolvePropertyDefault(val)); err == nil {
						tg.LoopCount = n
					}
				case "ThreadGroup.same_user_on_next_iteration":
					v := strings.ToLower(strings.TrimSpace(val))
					tg.SameUserOnIteration = (v == "true" || v == "1")
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
}

func parseSamplerProperties(decoder *xml.Decoder, s *HTTPSampler) {
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			return
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "HTTPSampler.domain":
					s.Domain = val
				case "HTTPSampler.port":
					s.Port = val
				case "HTTPSampler.protocol":
					s.Protocol = val
				case "HTTPSampler.path":
					s.Path = val
				case "HTTPSampler.method":
					s.Method = val
				case "HTTPSampler.follow_redirects":
					v := strings.ToLower(strings.TrimSpace(val))
					s.FollowRedirects = (v == "true" || v == "1")
				case "HTTPSampler.use_keepalive":
					v := strings.ToLower(strings.TrimSpace(val))
					s.UseKeepAlive = (v == "true" || v == "1")
				case "Argument.value":
					if s.Body == "" && val != "" {
						s.Body = val
					}
				case "HTTPSampler.connect_timeout":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						s.ConnectTimeoutMs = n
					}
				case "HTTPSampler.response_timeout":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						s.ResponseTimeoutMs = n
					}
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}

	// Normalize defaults
	if s.Protocol == "" {
		s.Protocol = "http"
	}
	if s.Port == "" {
		if strings.ToLower(s.Protocol) == "https" {
			s.Port = "443"
		} else {
			s.Port = "80"
		}
	}
	if s.Path == "" {
		s.Path = "/"
	}
}

func parseHeaderManager(decoder *xml.Decoder) map[string]string {
	headers := make(map[string]string)
	depth := 1
	var currentName string

	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				if propName == "Header.name" {
					currentName = val
				} else if propName == "Header.value" && currentName != "" {
					headers[currentName] = val
					currentName = ""
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	return headers
}

func parseRegexExtractor(decoder *xml.Decoder) *ExtractorRule {
	rule := &ExtractorRule{
		Type:         ExtractorRegex,
		Template:     "$1$",
		MatchNo:      1,
		DefaultValue: "",
	}
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "RegexExtractor.refname":
					rule.RefName = val
				case "RegexExtractor.regex":
					rule.Regex = val
				case "RegexExtractor.template":
					rule.Template = val
				case "RegexExtractor.match_number":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						rule.MatchNo = n
					}
				case "RegexExtractor.default":
					rule.DefaultValue = val
				case "RegexExtractor.useHeaders":
					v := strings.ToLower(strings.TrimSpace(val))
					rule.ScopeHeaders = (v == "true" || v == "1")
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	if rule.RefName == "" || rule.Regex == "" {
		return nil
	}
	return rule
}

func parseBoundaryExtractor(decoder *xml.Decoder) *ExtractorRule {
	rule := &ExtractorRule{
		Type:         ExtractorBoundary,
		MatchNo:      1,
		DefaultValue: "",
	}
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "BoundaryExtractor.refname":
					rule.RefName = val
				case "BoundaryExtractor.lboundary":
					rule.LeftBoundary = val
				case "BoundaryExtractor.rboundary":
					rule.RightBoundary = val
				case "BoundaryExtractor.match_number":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						rule.MatchNo = n
					}
				case "BoundaryExtractor.default":
					rule.DefaultValue = val
				case "BoundaryExtractor.useHeaders":
					v := strings.ToLower(strings.TrimSpace(val))
					rule.ScopeHeaders = (v == "true" || v == "1")
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	if rule.RefName == "" || (rule.LeftBoundary == "" && rule.RightBoundary == "") {
		return nil
	}
	return rule
}

func parseResponseAssertion(decoder *xml.Decoder) *ResponseAssertion {
	assertion := &ResponseAssertion{
		TestField:     "response_code",
		TestType:      AssertionEquals,
		Patterns:      make([]string, 0),
		AssumeSuccess: false,
	}
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "Assertion.test_field":
					assertion.TestField = val
				case "Assertion.test_type":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						assertion.TestType = n
						if (n & AssertionNot) != 0 {
							assertion.InvertRule = true
						}
					}
				case "Assertion.assume_success":
					v := strings.ToLower(strings.TrimSpace(val))
					assertion.AssumeSuccess = (v == "true" || v == "1")
				default:
					if val != "" && !strings.HasPrefix(propName, "Assertion.") {
						assertion.Patterns = append(assertion.Patterns, val)
					}
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	return assertion
}

func parseJSONPostProcessor(decoder *xml.Decoder) *ExtractorRule {
	rule := &ExtractorRule{
		Type:         ExtractorJSON,
		MatchNo:      1,
		DefaultValue: "",
	}
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "JSONPostProcessor.referenceNames":
					rule.RefName = strings.TrimSpace(val)
				case "JSONPostProcessor.jsonPathExprs":
					rule.JSONPath = strings.TrimSpace(val)
				case "JSONPostProcessor.match_numbers":
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						rule.MatchNo = n
					}
				case "JSONPostProcessor.defaultValues":
					rule.DefaultValue = val
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	if rule.RefName == "" || rule.JSONPath == "" {
		return nil
	}
	return rule
}

func parseTransactionControllerProperties(decoder *xml.Decoder, elem *FlowElement) {
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch el := t.(type) {
		case xml.StartElement:
			propName := getAttr(el.Attr, "name")
			switch el.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "TransactionController.parent":
					v := strings.ToLower(strings.TrimSpace(val))
					elem.GenerateParentSample = (v == "true" || v == "1")
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
}

func parseInnerLoopControllerProperties(decoder *xml.Decoder, elem *FlowElement) {
	elem.LoopCount = 1
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch el := t.(type) {
		case xml.StartElement:
			propName := getAttr(el.Attr, "name")
			switch el.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "LoopController.loops":
					clean := resolvePropertyDefault(val)
					elem.LoopCondition = clean
					if n, err := strconv.Atoi(clean); err == nil {
						elem.LoopCount = n
					}
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
}

func parseCSVDataSet(decoder *xml.Decoder) *CSVDataSetConfig {
	cfg := &CSVDataSetConfig{
		Delimiter:       ",",
		RecycleOnEOF:    true,
		StopThreadOnEOF: false,
	}
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "boolProp", "intProp", "longProp":
				val := readElementText(decoder)
				switch propName {
				case "filename":
					cfg.Filename = val
				case "variableNames":
					for _, v := range strings.Split(val, ",") {
						t := strings.TrimSpace(v)
						if t != "" {
							cfg.VariableNames = append(cfg.VariableNames, t)
						}
					}
				case "delimiter":
					cfg.Delimiter = val
				case "recycle":
					v := strings.ToLower(strings.TrimSpace(val))
					cfg.RecycleOnEOF = (v == "true" || v == "1")
				case "stopThread":
					v := strings.ToLower(strings.TrimSpace(val))
					cfg.StopThreadOnEOF = (v == "true" || v == "1")
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	if cfg.Filename == "" {
		return nil
	}
	return cfg
}

func parseConstantTimer(decoder *xml.Decoder) int {
	delay := 0
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "intProp", "longProp":
				val := readElementText(decoder)
				if propName == "ConstantTimer.delay" {
					if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
						delay = n
					}
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	return delay
}

func parseUniformRandomTimer(decoder *xml.Decoder) (int, int) {
	delay := 0
	rng := 0
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch elem := t.(type) {
		case xml.StartElement:
			propName := getAttr(elem.Attr, "name")
			switch elem.Name.Local {
			case "stringProp", "intProp", "longProp":
				val := readElementText(decoder)
				cleanVal := strings.TrimSpace(val)
				if propName == "ConstantTimer.delay" || propName == "delay" {
					if f, err := strconv.ParseFloat(cleanVal, 64); err == nil {
						delay = int(f)
					}
				} else if propName == "RandomTimer.range" || propName == "range" {
					if f, err := strconv.ParseFloat(cleanVal, 64); err == nil {
						rng = int(f)
					}
				}
			default:
				depth++
			}
		case xml.EndElement:
			depth--
		}
	}
	return delay, rng
}

func getAttr(attrs []xml.Attr, name string) string {
	for _, a := range attrs {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func resolvePropertyDefault(val string) string {
	clean := strings.TrimSpace(val)
	if (strings.HasPrefix(clean, "${__P(") || strings.HasPrefix(clean, "${__property(")) && strings.HasSuffix(clean, "}") {
		start := strings.Index(clean, "(")
		end := strings.LastIndex(clean, ")")
		if start != -1 && end > start {
			inner := clean[start+1 : end]
			parts := strings.Split(inner, ",")
			propName := strings.TrimSpace(parts[0])
			if propVal, exists := GetProperty(propName); exists {
				return propVal
			}
			if len(parts) > 1 {
				return strings.TrimSpace(parts[1])
			}
			return "1" // JMeter default for single-argument ${__P(NAME)} is 1
		}
	}
	return clean
}

// readElementText reads characters inside an element until its matching closing tag,
// handling nested tags if any, and returning the concatenated text.
func readElementText(decoder *xml.Decoder) string {
	var sb strings.Builder
	depth := 1
	for depth > 0 {
		t, err := decoder.Token()
		if err != nil {
			break
		}
		switch tok := t.(type) {
		case xml.StartElement:
			depth++
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 1 {
				sb.Write(tok)
			}
		}
	}
	return sb.String()
}
