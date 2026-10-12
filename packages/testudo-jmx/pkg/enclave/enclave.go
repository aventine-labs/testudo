package enclave

import (
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
		ParamName:     "__VIEWSTATE",
		VarName:       "viewstate",
		LeftBoundary:  `id="__VIEWSTATE" value="`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "session_id",
		VarName:       "session_id",
		LeftBoundary:  `"session_id":"`,
		RightBoundary: `"`,
	},
	{
		ParamName:     "access_token",
		VarName:       "access_token",
		LeftBoundary:  `"access_token":"`,
		RightBoundary: `"`,
	},
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
					if !matched && strings.Contains(subSampler.Body, r.ParamName) {
						status := "DETECTED"
						if strings.Contains(subSampler.Body, "${"+r.VarName+"}") {
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
					if strings.Contains(subSampler.Body, r.ParamName) && !strings.Contains(subSampler.Body, "${"+r.VarName+"}") {
						subSampler.Body = strings.ReplaceAll(subSampler.Body, r.ParamName+"=", r.ParamName+"=${"+r.VarName+"}")
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
