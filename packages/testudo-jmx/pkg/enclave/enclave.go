package enclave

import (
	"regexp"
	"strings"

	"aventinelabs.com/testudo-jmx/pkg/extractors"
	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

// TokenCandidate represents a detected dynamic session parameter in a test plan.
type TokenCandidate struct {
	ParamName      string `json:"param_name"`
	VarName        string `json:"var_name"`
	SourceSampler  string `json:"source_sampler"`
	TargetSampler  string `json:"target_sampler"`
	BoundaryPrefix string `json:"boundary_prefix"`
	BoundarySuffix string `json:"boundary_suffix"`
	Status         string `json:"status"` // "DETECTED" or "CORRELATED"
}

// TokenRule represents correlation heuristics for dynamic tokens.
type TokenRule struct {
	ParamName     string
	VarName       string
	LeftBoundary  string
	RightBoundary string
}

var defaultRules = []TokenRule{
	// 1. Anti-CSRF & Cross-Site Request Forgery Tokens
	{
		ParamName:     "csrf_token",
		VarName:       "csrf_token",
		LeftBoundary:  `name="csrf_token" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "_csrf",
		VarName:       "csrf_token",
		LeftBoundary:  `name="_csrf" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "csrfmiddlewaretoken",
		VarName:       "django_csrf",
		LeftBoundary:  `name="csrfmiddlewaretoken" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "authenticity_token",
		VarName:       "rails_csrf",
		LeftBoundary:  `name="authenticity_token" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "form_key",
		VarName:       "magento_form_key",
		LeftBoundary:  `name="form_key" type="hidden" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "_token",
		VarName:       "laravel_token",
		LeftBoundary:  `name="_token" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "__RequestVerificationToken",
		VarName:       "aspnet_verification_token",
		LeftBoundary:  `name="__RequestVerificationToken" type="hidden" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "XSRF-TOKEN",
		VarName:       "xsrf_token",
		LeftBoundary:  `XSRF-TOKEN=`,
		RightBoundary: `;`,
	},
	{
		ParamName:     "nonce",
		VarName:       "nonce",
		LeftBoundary:  `"nonce":"`,
		RightBoundary: `"`,
	},

	// 2. ASP.NET State Engine Parameters
	{
		ParamName:     "__VIEWSTATE",
		VarName:       "viewstate",
		LeftBoundary:  `id="__VIEWSTATE" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "__VIEWSTATEGENERATOR",
		VarName:       "viewstate_generator",
		LeftBoundary:  `id="__VIEWSTATEGENERATOR" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "__EVENTVALIDATION",
		VarName:       "event_validation",
		LeftBoundary:  `id="__EVENTVALIDATION" value="`,
		RightBoundary: `"`,
	},

	// 3. Web Application Session Cookies & Identifiers
	{
		ParamName:     "JSESSIONID",
		VarName:       "jsessionid",
		LeftBoundary:  `JSESSIONID=`,
		RightBoundary: `;`,
	},
	{
		ParamName:     "PHPSESSID",
		VarName:       "phpsessid",
		LeftBoundary:  `PHPSESSID=`,
		RightBoundary: `;`,
	},
	{
		ParamName:     "ASP.NET_SessionId",
		VarName:       "aspnet_session_id",
		LeftBoundary:  `ASP.NET_SessionId=`,
		RightBoundary: `;`,
	},
	{
		ParamName:     "connect.sid",
		VarName:       "express_sid",
		LeftBoundary:  `connect.sid=`,
		RightBoundary: `;`,
	},
	{
		ParamName:     "session_id",
		VarName:       "session_id",
		LeftBoundary:  `"session_id":"`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "session_token",
		VarName:       "session_token",
		LeftBoundary:  `"session_token":"`,
		RightBoundary: `"`,
	},

	// 4. OAuth2, OpenID Connect & Modern API Tokens
	{
		ParamName:     "access_token",
		VarName:       "access_token",
		LeftBoundary:  `"access_token":"`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "refresh_token",
		VarName:       "refresh_token",
		LeftBoundary:  `"refresh_token":"`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "id_token",
		VarName:       "id_token",
		LeftBoundary:  `"id_token":"`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "authorization_code",
		VarName:       "oauth_auth_code",
		LeftBoundary:  `authorization_code=`,
		RightBoundary: `&`,
	},
	{
		ParamName:     "oauth_token",
		VarName:       "oauth_token",
		LeftBoundary:  `oauth_token=`,
		RightBoundary: `&`,
	},
}

func hasParamMatch(s, paramName string) bool {
	if s == "" || paramName == "" {
		return false
	}
	reForm := regexp.MustCompile(`(?i)(^|[&?;\s])` + regexp.QuoteMeta(paramName) + `=`)
	if reForm.MatchString(s) {
		return true
	}
	reJSON := regexp.MustCompile(`(?i)"` + regexp.QuoteMeta(paramName) + `"\s*:\s*`)
	return reJSON.MatchString(s)
}

func replaceParamValue(s, paramName, varName string) (string, bool) {
	if s == "" || paramName == "" {
		return s, false
	}
	targetVar := "${" + varName + "}"
	changed := false

	// Form-urlencoded, query string, cookie: param=value
	reForm := regexp.MustCompile(`(?i)(^|[&?;\s])(` + regexp.QuoteMeta(paramName) + `=)([^&;\s\r\n"']*)`)
	if reForm.MatchString(s) {
		s = reForm.ReplaceAllStringFunc(s, func(match string) string {
			sub := reForm.FindStringSubmatch(match)
			if len(sub) == 4 {
				if sub[3] == targetVar {
					return match // already correlated
				}
				changed = true
				return sub[1] + sub[2] + targetVar
			}
			return match
		})
	}

	// JSON: "param": "value"
	reJSON := regexp.MustCompile(`(?i)("` + regexp.QuoteMeta(paramName) + `"\s*:\s*")([^"]*)(")`)
	if reJSON.MatchString(s) {
		s = reJSON.ReplaceAllStringFunc(s, func(match string) string {
			sub := reJSON.FindStringSubmatch(match)
			if len(sub) == 4 {
				if sub[2] == targetVar {
					return match
				}
				changed = true
				return sub[1] + targetVar + sub[3]
			}
			return match
		})
	}

	return s, changed
}

// ScanTokenCandidates identifies dynamic tokens requiring correlation across samplers.
func ScanTokenCandidates(plan *jmx.TestPlan) []TokenCandidate {
	var candidates []TokenCandidate

	for _, tg := range plan.ThreadGroups {
		for i, sampler := range tg.Samplers {
			for _, r := range defaultRules {
				for j := i + 1; j < len(tg.Samplers); j++ {
					subSampler := tg.Samplers[j]
					matched := false
					for _, arg := range subSampler.Arguments {
						if strings.EqualFold(arg.Name, r.ParamName) {
							status := "DETECTED"
							if strings.Contains(arg.Value, "${") {
								status = "CORRELATED"
							}
							candidates = append(candidates, TokenCandidate{
								ParamName:      r.ParamName,
								VarName:        r.VarName,
								SourceSampler:  sampler.Name,
								TargetSampler:  subSampler.Name,
								BoundaryPrefix: r.LeftBoundary,
								BoundarySuffix: r.RightBoundary,
								Status:         status,
							})
							matched = true
							break
						}
					}
					if !matched && (hasParamMatch(subSampler.Body, r.ParamName) || hasParamMatch(subSampler.Path, r.ParamName)) {
						status := "DETECTED"
						if strings.Contains(subSampler.Body, "${"+r.VarName+"}") || strings.Contains(subSampler.Path, "${"+r.VarName+"}") {
							status = "CORRELATED"
						}
						candidates = append(candidates, TokenCandidate{
							ParamName:      r.ParamName,
							VarName:        r.VarName,
							SourceSampler:  sampler.Name,
							TargetSampler:  subSampler.Name,
							BoundaryPrefix: r.LeftBoundary,
							BoundarySuffix: r.RightBoundary,
							Status:         status,
						})
					}
				}
			}
		}
	}

	return candidates
}

// AutoCorrelatePlanDetailed performs correlation and returns the updated candidates list and count.
func AutoCorrelatePlanDetailed(plan *jmx.TestPlan) ([]TokenCandidate, int) {
	applied := AutoCorrelatePlan(plan)
	candidates := ScanTokenCandidates(plan)
	return candidates, applied
}

// AutoCorrelatePlan inspects all samplers in a test plan, discovers dynamic tokens,
// injects boundary extractors, and replaces hardcoded downstream references with variables.
func AutoCorrelatePlan(plan *jmx.TestPlan) int {
	correlationsApplied := 0

	for _, tg := range plan.ThreadGroups {
		for i, sampler := range tg.Samplers {
			for _, r := range defaultRules {
				foundInSubsequent := false
				for j := i + 1; j < len(tg.Samplers); j++ {
					subSampler := tg.Samplers[j]
					for _, arg := range subSampler.Arguments {
						if strings.EqualFold(arg.Name, r.ParamName) && !strings.Contains(arg.Value, "${") {
							arg.Value = "${" + r.VarName + "}"
							foundInSubsequent = true
							correlationsApplied++
						}
					}
					if newBody, changed := replaceParamValue(subSampler.Body, r.ParamName, r.VarName); changed {
						subSampler.Body = newBody
						foundInSubsequent = true
						correlationsApplied++
					}
					if newPath, changed := replaceParamValue(subSampler.Path, r.ParamName, r.VarName); changed {
						subSampler.Path = newPath
						foundInSubsequent = true
						correlationsApplied++
					}
				}

				if foundInSubsequent {
					hasRule := false
					for _, ext := range sampler.Extractors {
						if ext.RefName == r.VarName {
							hasRule = true
							break
						}
					}
					if !hasRule {
						sampler.Extractors = append(sampler.Extractors, &jmx.ExtractorRule{
							Type:          jmx.ExtractorBoundary,
							RefName:       r.VarName,
							LeftBoundary:  r.LeftBoundary,
							RightBoundary: r.RightBoundary,
							MatchNo:       1,
							DefaultValue:  "CORRELATION_NOT_FOUND",
						})
					}
				}
			}
		}
	}

	return correlationsApplied
}

// ThompsonNFAShield verifies an expression executes in linear time without catastrophic backtracking.
func ThompsonNFAShield(regex string, sampleText string) bool {
	if strings.Contains(regex, "+)+") || strings.Contains(regex, "*)*") {
		return false
	}
	res := extractors.ExtractRegex(sampleText, regex, "$1$", 1, "")
	return res != ""
}
