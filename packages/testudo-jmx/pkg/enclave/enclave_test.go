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

func TestEnclaveBodyDelimitersAndNoConcatenation(t *testing.T) {
	plan := &jmx.TestPlan{
		Name: "Test Enclave Delimiter Plan",
		ThreadGroups: []*jmx.ThreadGroup{
			{
				Name: "TG 1",
				Samplers: []*jmx.HTTPSampler{
					{
						Name: "Sampler 1 - View Catalog",
						Path: "/catalog",
					},
					{
						Name: "Sampler 2 - Add to Cart URL Encoded",
						Path: "/checkout/cart/add",
						Body: "form_key=AbC123XyZ&qty=2&postcode=12401",
					},
					{
						Name: "Sampler 3 - JSON Checkout",
						Path: "/api/checkout",
						Body: `{"form_key": "AbC123XyZ", "postcode": "12401"}`,
					},
					{
						Name: "Sampler 4 - OAuth Code in Query String",
						Path: "/oauth/callback?authorization_code=AUTH999&postcode=12401",
					},
					{
						Name: "Sampler 5 - Generic State and Promo Code",
						Path: "/checkout?state=NY&code=SUMMER10",
					},
				},
			},
		},
	}

	applied := AutoCorrelatePlan(plan)
	if applied == 0 {
		t.Fatalf("expected correlations to be applied, got %d", applied)
	}

	// Verify Sampler 2: form_key replaced cleanly without concatenating old value, postcode untouched
	s2 := plan.ThreadGroups[0].Samplers[1]
	expectedS2 := "form_key=${magento_form_key}&qty=2&postcode=12401"
	if s2.Body != expectedS2 {
		t.Errorf("Sampler 2 body mismatch:\nGot:  %s\nWant: %s", s2.Body, expectedS2)
	}

	// Verify Sampler 3: JSON form_key replaced cleanly, postcode untouched
	s3 := plan.ThreadGroups[0].Samplers[2]
	expectedS3 := `{"form_key": "${magento_form_key}", "postcode": "12401"}`
	if s3.Body != expectedS3 {
		t.Errorf("Sampler 3 body mismatch:\nGot:  %s\nWant: %s", s3.Body, expectedS3)
	}

	// Verify Sampler 4: authorization_code replaced in query path, postcode untouched
	s4 := plan.ThreadGroups[0].Samplers[3]
	expectedS4 := "/oauth/callback?authorization_code=${oauth_auth_code}&postcode=12401"
	if s4.Path != expectedS4 {
		t.Errorf("Sampler 4 path mismatch:\nGot:  %s\nWant: %s", s4.Path, expectedS4)
	}

	// Verify Sampler 5: state=NY and code=SUMMER10 are NOT corrupted into oauth tokens
	s5 := plan.ThreadGroups[0].Samplers[4]
	expectedS5 := "/checkout?state=NY&code=SUMMER10"
	if s5.Path != expectedS5 {
		t.Errorf("Sampler 5 path mismatch: expected state=NY and code=SUMMER10 to remain untouched, got: %s", s5.Path)
	}
}

