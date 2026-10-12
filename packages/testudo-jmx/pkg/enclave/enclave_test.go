package enclave

import (
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

func TestEnclaveScanAndCorrelate(t *testing.T) {
	plan := &jmx.TestPlan{
		Name: "Test Enclave Plan",
		ThreadGroups: []*jmx.ThreadGroup{
			{
				Name: "TG 1",
				Samplers: []*jmx.HTTPSampler{
					{
						Name: "Sampler 1 - Login",
						Path: "/login",
					},
					{
						Name: "Sampler 2 - Submit",
						Path: "/submit",
						Arguments: []*jmx.HTTPArgument{
							{
								Name:  "csrf_token",
								Value: "STATIC_RAW_TOKEN_VALUE",
							},
						},
					},
				},
			},
		},
	}

	candidates := ScanTokenCandidates(plan)
	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].Status != "DETECTED" {
		t.Errorf("expected status DETECTED, got %s", candidates[0].Status)
	}

	updatedCandidates, applied := AutoCorrelatePlanDetailed(plan)
	if applied != 1 {
		t.Errorf("expected 1 correlation applied, got %d", applied)
	}
	if len(updatedCandidates) != 1 || updatedCandidates[0].Status != "CORRELATED" {
		t.Errorf("expected status CORRELATED after correlation")
	}

	// Verify variable replacement
	arg := plan.ThreadGroups[0].Samplers[1].Arguments[0]
	if arg.Value != "${csrf_token}" {
		t.Errorf("expected ${csrf_token}, got %s", arg.Value)
	}

	// Verify boundary extractor injected
	s1 := plan.ThreadGroups[0].Samplers[0]
	if len(s1.Extractors) != 1 {
		t.Fatalf("expected 1 extractor on sampler 1, got %d", len(s1.Extractors))
	}
	if s1.Extractors[0].RefName != "csrf_token" {
		t.Errorf("expected ref_name csrf_token, got %s", s1.Extractors[0].RefName)
	}
}
