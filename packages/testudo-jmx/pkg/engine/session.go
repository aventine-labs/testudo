package engine

import (
	"context"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/cookiejar"
	"strconv"
	"strings"
	"time"

	"aventinelabs.com/testudo-jmx/pkg/extractors"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
	"aventinelabs.com/testudo-jmx/pkg/transport"
)

// UserSession encapsulates the isolated execution state of a single virtual user thread.
type UserSession struct {
	ThreadID           int
	ThreadGroup        string
	Variables          map[string]string
	Client             *http.Client
	Jar                *cookiejar.Jar
	Collector          *Collector
	ResultChan         chan<- *transport.SampleResult
	TransportCfg       transport.TransportConfig
	RecycleOnIter      bool
	FlowElements       []*jmx.FlowElement
	DecomposeRedirects bool
}

// NewUserSession instantiates a clean virtual user session with cookie isolation and dedicated transport.
func NewUserSession(id int, tg *jmx.ThreadGroup, plan *jmx.TestPlan, coll *Collector, ch chan<- *transport.SampleResult, tcfg transport.TransportConfig) *UserSession {
	tr := transport.BuildRoundTripper(tcfg, false)
	return NewUserSessionWithTransport(id, tg, plan, coll, ch, tcfg, tr)
}

// NewUserSessionWithTransport instantiates a virtual user session using a pooled transport while preserving full cookie and variable isolation.
func NewUserSessionWithTransport(id int, tg *jmx.ThreadGroup, plan *jmx.TestPlan, coll *Collector, ch chan<- *transport.SampleResult, tcfg transport.TransportConfig, tr http.RoundTripper) *UserSession {
	vars := make(map[string]string)
	for k, v := range plan.UserVariables {
		vars[k] = v
	}
	for k, v := range tg.Variables {
		vars[k] = v
	}
	vars["__threadNum"] = strconv.Itoa(id)

	jar, _ := cookiejar.New(nil)

	client := &http.Client{
		Transport: tr,
		Jar:       jar,
		Timeout:   tcfg.ResponseTimeout,
	}

	return &UserSession{
		ThreadID:           id,
		ThreadGroup:        tg.Name,
		Variables:          vars,
		Client:             client,
		Jar:                jar,
		Collector:          coll,
		ResultChan:         ch,
		TransportCfg:       tcfg,
		RecycleOnIter:      tcfg.RecycleOnIter,
		FlowElements:       tg.FlowElements,
		DecomposeRedirects: false,
	}
}

// ExecuteIteration executes all flow elements (page breaks, loops, samplers) sequentially.
func (s *UserSession) ExecuteIteration(ctx context.Context, samplers []*jmx.HTTPSampler, globalHeaders map[string]string) error {
	iterStart := time.Now()
	var samplersElapsedUs int64

	// If session connection recycling is enabled, tear down the transport pool per iteration
	if s.RecycleOnIter {
		s.Client.Transport = transport.BuildRoundTripper(s.TransportCfg, false)
	}

	if len(s.FlowElements) > 0 {
		if _, _, err := s.executeFlowElements(ctx, s.FlowElements, globalHeaders, &samplersElapsedUs); err != nil {
			return err
		}
	} else {
		if err := s.executeSamplerList(ctx, samplers, globalHeaders, &samplersElapsedUs); err != nil {
			return err
		}
	}

	iterDurationUs := time.Since(iterStart).Microseconds()
	offClockUs := iterDurationUs - samplersElapsedUs
	if offClockUs < 0 {
		offClockUs = 0
	}
	s.Collector.RecordIteration(iterDurationUs, offClockUs)

	return nil
}

func (s *UserSession) executeFlowElements(ctx context.Context, elements []*jmx.FlowElement, globalHeaders map[string]string, samplersElapsedUs *int64) (int64, bool, error) {
	var totalBytes int64
	allSuccess := true

	for _, elem := range elements {
		select {
		case <-ctx.Done():
			return totalBytes, allSuccess, ctx.Err()
		default:
		}

		if !elem.Enabled {
			continue
		}

		switch elem.Type {
		case jmx.FlowTypeSampler:
			if elem.Sampler != nil {
				b, succ, err := s.executeSingleSampler(ctx, elem.Sampler, globalHeaders, samplersElapsedUs)
				totalBytes += b
				if !succ {
					allSuccess = false
				}
				if err != nil {
					return totalBytes, allSuccess, err
				}
			}

		case jmx.FlowTypePageBreak:
			pageStart := time.Now()
			var pageBytesReceived int64
			pageSuccess := true

			// Execute child elements within this page break
			for _, child := range elem.Children {
				b, succ, err := s.executeFlowElements(ctx, []*jmx.FlowElement{child}, globalHeaders, samplersElapsedUs)
				pageBytesReceived += b
				if !succ {
					pageSuccess = false
				}
				if err != nil {
					return totalBytes, allSuccess, err
				}
			}

			pageDur := time.Since(pageStart)
			totalBytes += pageBytesReceived
			if !pageSuccess {
				allSuccess = false
			}

			if elem.GenerateParentSample {
				statusCode := 200
				responseMsg := "200 OK"
				if !pageSuccess {
					statusCode = 500
					responseMsg = "500 Page Sub-Sample Failed"
				}
				pageRes := &transport.SampleResult{
					Label:           elem.Name,
					URL:             elem.Name,
					Method:          "PAGE",
					StatusCode:      statusCode,
					ResponseMessage: responseMsg,
					Success:         pageSuccess,
					TimestampMs:     pageStart.UnixMilli(),
					ElapsedMs:       transport.JtlMillis(pageDur),
					ElapsedUs:       pageDur.Microseconds(),
					BytesReceived:   pageBytesReceived,
				}
				s.Collector.RecordSample(pageRes)
				if s.ResultChan != nil {
					select {
					case s.ResultChan <- pageRes:
					default:
						s.Collector.RecordDroppedSample()
					}
				}
			}

		case jmx.FlowTypeLoop:
			count := elem.LoopCount
			if count <= 0 && elem.LoopCondition != "" {
				resolved := jmx.EvaluateString(elem.LoopCondition, s.Variables, s.ThreadID)
				if n, err := strconv.Atoi(strings.TrimSpace(resolved)); err == nil {
					count = n
				}
			}
			if count <= 0 {
				count = 1
			}

			for i := 0; i < count; i++ {
				s.Variables[fmt.Sprintf("__jm__%s__idx", elem.Name)] = strconv.Itoa(i)
				s.Variables["__loop_idx"] = strconv.Itoa(i)
				b, succ, err := s.executeFlowElements(ctx, elem.Children, globalHeaders, samplersElapsedUs)
				totalBytes += b
				if !succ {
					allSuccess = false
				}
				if err != nil {
					return totalBytes, allSuccess, err
				}
			}
		}
	}
	return totalBytes, allSuccess, nil
}

func (s *UserSession) executeSamplerList(ctx context.Context, samplers []*jmx.HTTPSampler, globalHeaders map[string]string, samplersElapsedUs *int64) error {
	for _, sampler := range samplers {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if _, _, err := s.executeSingleSampler(ctx, sampler, globalHeaders, samplersElapsedUs); err != nil {
			return err
		}
	}
	return nil
}

func (s *UserSession) executeSingleSampler(ctx context.Context, sampler *jmx.HTTPSampler, globalHeaders map[string]string, samplersElapsedUs *int64) (int64, bool, error) {
	if !sampler.Enabled {
		return 0, true, nil
	}

	// Apply timer think time if configured with context-cancellation awareness
	if sampler.TimerDelayMs > 0 || sampler.TimerRangeMs > 0 {
		delay := sampler.TimerDelayMs
		if sampler.TimerRangeMs > 0 {
			delay += rand.Intn(sampler.TimerRangeMs)
		}
		if delay > 0 {
			timer := time.NewTimer(time.Duration(delay) * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return 0, false, ctx.Err()
			case <-timer.C:
			}
		}
	}

	// Evaluate dynamic variables in URL parameters and body
	evaluatedDomain := jmx.EvaluateString(sampler.Domain, s.Variables, s.ThreadID)
	evaluatedPortStr := jmx.EvaluateString(sampler.Port, s.Variables, s.ThreadID)
	evaluatedPort, _ := strconv.Atoi(evaluatedPortStr)
	evaluatedPath := jmx.EvaluateString(sampler.Path, s.Variables, s.ThreadID)
	evaluatedBody := jmx.EvaluateString(sampler.Body, s.Variables, s.ThreadID)

	// Merge and evaluate headers
	mergedHeaders := make(map[string]string)
	for k, v := range globalHeaders {
		mergedHeaders[k] = jmx.EvaluateString(v, s.Variables, s.ThreadID)
	}
	for k, v := range sampler.Headers {
		mergedHeaders[k] = jmx.EvaluateString(v, s.Variables, s.ThreadID)
	}

	// Handle Keep-Alive header override
	if s.TransportCfg.KeepAliveMode == jmx.KeepAliveForceOff || !sampler.UseKeepAlive {
		mergedHeaders["Connection"] = "close"
	} else if s.TransportCfg.KeepAliveMode == jmx.KeepAliveForceOn {
		mergedHeaders["Connection"] = "keep-alive"
	}

	// Build target URL
	queryArgs := make(map[string]string)
	for _, arg := range sampler.Arguments {
		queryArgs[arg.Name] = jmx.EvaluateString(arg.Value, s.Variables, s.ThreadID)
	}
	targetURL := transport.BuildFullURL(sampler.Protocol, evaluatedDomain, evaluatedPort, evaluatedPath, queryArgs)

	var res *transport.SampleResult
	var err error
	if s.DecomposeRedirects && sampler.FollowRedirects {
		res, err = transport.ExecuteRequestDecomposed(ctx, s.Client, sampler.Method, targetURL, evaluatedBody, mergedHeaders)
	} else {
		res, err = transport.ExecuteRequest(ctx, s.Client, sampler.Method, targetURL, evaluatedBody, mergedHeaders)
	}
	if err != nil {
		errSample := &transport.SampleResult{
			Label:           sampler.Name,
			URL:             targetURL,
			Method:          sampler.Method,
			StatusCode:      0,
			ResponseMessage: "Non HTTP response message: " + err.Error(),
			Success:         false,
			TimestampMs:     time.Now().UnixMilli(),
			ErrorMessage:    err.Error(),
		}
		s.Collector.RecordSample(errSample)
		if s.ResultChan != nil {
			select {
			case s.ResultChan <- errSample:
			default:
				s.Collector.RecordDroppedSample()
			}
		}
		return 0, false, nil
	}
	if ctx.Err() != nil {
		return 0, false, ctx.Err()
	}
	res.Label = sampler.Name
	*samplersElapsedUs += res.ElapsedUs

	// Evaluate extractors and update thread-local variables
	s.applyExtractors(sampler.Extractors, res)

	// Evaluate assertions
	s.applyAssertions(sampler.Assertions, res)

	// If decomposed sub-samples exist, push them to results channel
	if s.DecomposeRedirects && len(res.SubSamples) > 0 {
		for _, sub := range res.SubSamples {
			s.Collector.RecordSample(sub)
			if s.ResultChan != nil {
				select {
				case s.ResultChan <- sub:
				default:
					s.Collector.RecordDroppedSample()
				}
			}
		}
	}

	// Push parent sample to collector and results channel
	s.Collector.RecordSample(res)
	if s.ResultChan != nil {
		select {
		case s.ResultChan <- res:
		default:
			s.Collector.RecordDroppedSample()
		}
	}

	return res.BytesReceived, res.Success, nil
}

func (s *UserSession) applyExtractors(rules []*jmx.ExtractorRule, res *transport.SampleResult) {
	for _, rule := range rules {
		targetText := res.ResponseBody
		if rule.ScopeHeaders {
			var sb strings.Builder
			for k, v := range res.ResponseHeaders {
				sb.WriteString(k + ": " + strings.Join(v, ", ") + "\n")
			}
			targetText = sb.String()
		}

		var extracted string
		switch rule.Type {
		case jmx.ExtractorBoundary:
			extracted = extractors.ExtractBoundary(targetText, rule.LeftBoundary, rule.RightBoundary, rule.MatchNo, rule.DefaultValue)
		case jmx.ExtractorRegex:
			if rule.MatchNo == -1 {
				extractors.ExtractMultiRegex(targetText, rule.Regex, rule.Template, rule.RefName, s.Variables)
				continue
			}
			extracted = extractors.ExtractRegex(targetText, rule.Regex, rule.Template, rule.MatchNo, rule.DefaultValue)
		case jmx.ExtractorJSON:
			extracted = extractors.ExtractJSON(targetText, rule.JSONPath, rule.MatchNo, rule.DefaultValue)
		default:
			continue
		}

		if extracted != "" {
			s.Variables[rule.RefName] = extracted
		} else if rule.DefaultValue != "" {
			s.Variables[rule.RefName] = rule.DefaultValue
		}
	}
}

func (s *UserSession) applyAssertions(assertions []*jmx.ResponseAssertion, res *transport.SampleResult) {
	for _, a := range assertions {
		textToTest := res.ResponseBody
		if a.TestField == "response_code" {
			textToTest = strconv.Itoa(res.StatusCode)
		} else if a.TestField == "response_headers" {
			var sb strings.Builder
			for k, v := range res.ResponseHeaders {
				sb.WriteString(k + ": " + strings.Join(v, ", ") + "\n")
			}
			textToTest = sb.String()
		}

		for _, pat := range a.Patterns {
			matches := strings.Contains(textToTest, pat)
			if a.InvertRule {
				matches = !matches
			}
			if !matches {
				res.Success = false
				if a.InvertRule {
					res.ErrorMessage = "Assertion failed (NOT): response matched " + pat
				} else {
					res.ErrorMessage = "Assertion failed: response did not match " + pat
				}
				break
			}
		}
	}
}
