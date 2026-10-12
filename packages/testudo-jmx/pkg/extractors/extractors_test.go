package extractors_test

import (
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/extractors"
)

func TestBoundaryExtractor(t *testing.T) {
	body := `{"status":"ok","token":"SEC_998877_XYZ","user":"admin"}`
	res := extractors.ExtractBoundary(body, `"token":"`, `"`, 1, "NOT_FOUND")
	if res != "SEC_998877_XYZ" {
		t.Errorf("Expected SEC_998877_XYZ, got %s", res)
	}

	// Missing boundary
	missing := extractors.ExtractBoundary(body, `"csrf":"`, `"`, 1, "DEFAULT_FALLBACK")
	if missing != "DEFAULT_FALLBACK" {
		t.Errorf("Expected DEFAULT_FALLBACK, got %s", missing)
	}
}

func TestRegexExtractor(t *testing.T) {
	html := `<input type="hidden" name="authenticity_token" value="abc123xyz"/>`
	pattern := `name="authenticity_token" value="([^"]+)"`
	res := extractors.ExtractRegex(html, pattern, "$1$", 1, "NOT_FOUND")
	if res != "abc123xyz" {
		t.Errorf("Expected abc123xyz, got %s", res)
	}

	// Multi-group template
	csv := `user:mark,role:admin,id:42`
	resMulti := extractors.ExtractRegex(csv, `user:([^,]+),role:([^,]+)`, "$1_is_$2", 1, "")
	if resMulti != "mark_is_admin" {
		t.Errorf("Expected mark_is_admin, got %s", resMulti)
	}

	// Test literal dollar sign in extracted content (e.g. $5.99 must not strip $5)
	priceText := `The total price is $5.99 USD`
	priceRes := extractors.ExtractRegex(priceText, `is (\$5\.\d+)`, "$1$", 1, "FAIL")
	if priceRes != "$5.99" {
		t.Errorf("Expected $5.99 preserved without stripping, got %s", priceRes)
	}

	// Test literal template (e.g. "fixed" returns "fixed")
	literalRes := extractors.ExtractRegex(priceText, `is (\$5\.\d+)`, "fixed", 1, "FAIL")
	if literalRes != "fixed" {
		t.Errorf("Expected fixed for literal template, got %s", literalRes)
	}

	// Test ExtractMultiRegex populating ref_1, ref_2, and ref_matchNr
	multiText := `token=TOKEN1; token=TOKEN2; token=TOKEN3;`
	vars := make(map[string]string)
	extractors.ExtractMultiRegex(multiText, `token=([A-Z0-9]+);`, "$1$", "auth_tok", vars)
	if vars["auth_tok_matchNr"] != "3" {
		t.Errorf("Expected matchNr 3, got %s", vars["auth_tok_matchNr"])
	}
	if vars["auth_tok_1"] != "TOKEN1" || vars["auth_tok_2"] != "TOKEN2" || vars["auth_tok_3"] != "TOKEN3" {
		t.Errorf("Expected TOKEN1, TOKEN2, TOKEN3, got %s, %s, %s", vars["auth_tok_1"], vars["auth_tok_2"], vars["auth_tok_3"])
	}
}

func TestJSONExtractor(t *testing.T) {
	jsonPayload := `{
		"status": "success",
		"data": {
			"token": "JWT_TOKEN_ABC_123",
			"user": {
				"id": 9942,
				"active": true
			},
			"items": [
				{"name": "Laptop", "price": 1299.99},
				{"name": "Mouse", "price": 49.50}
			]
		}
	}`

	// Test dot notation
	t1 := extractors.ExtractJSON(jsonPayload, "$.data.token", 1, "FAIL")
	if t1 != "JWT_TOKEN_ABC_123" {
		t.Errorf("Expected JWT_TOKEN_ABC_123, got %s", t1)
	}

	// Test nested integer
	t2 := extractors.ExtractJSON(jsonPayload, "data.user.id", 1, "FAIL")
	if t2 != "9942" {
		t.Errorf("Expected 9942, got %s", t2)
	}

	// Test boolean
	t3 := extractors.ExtractJSON(jsonPayload, "$.data.user.active", 1, "FAIL")
	if t3 != "true" {
		t.Errorf("Expected true, got %s", t3)
	}

	// Test array index
	t4 := extractors.ExtractJSON(jsonPayload, "$.data.items[1].name", 1, "FAIL")
	if t4 != "Mouse" {
		t.Errorf("Expected Mouse, got %s", t4)
	}

	// Test default value on missing field
	t5 := extractors.ExtractJSON(jsonPayload, "$.data.nonexistent", 1, "DEFAULT_VAL")
	if t5 != "DEFAULT_VAL" {
		t.Errorf("Expected DEFAULT_VAL, got %s", t5)
	}
}

func TestRegexExtractorSecurityBounds(t *testing.T) {
	// 1. Oversized pattern (exceeding 8192 bytes) must fail closed safely
	oversizedPattern := `user_(` + string(make([]byte, 8200)) + `)`
	res := extractors.ExtractRegex("user_test", oversizedPattern, "$1$", 1, "FALLBACK_SAFE")
	if res != "FALLBACK_SAFE" {
		t.Errorf("Expected fallback on oversized regex, got %s", res)
	}

	// 2. High-quantifier / potential integer overflow pattern must compile or reject cleanly without crash
	overflowPattern := `a{999999999999999999999999999999}`
	resOverflow := extractors.ExtractRegex("aaaaa", overflowPattern, "$0$", 1, "OVERFLOW_BLOCKED")
	if resOverflow != "OVERFLOW_BLOCKED" {
		t.Errorf("Expected fallback on integer overflow quantifier, got %s", resOverflow)
	}

	// 3. Repeated compilation of same pattern hits cache correctly
	pattern := `id=(\d+)`
	text := `item id=42; name=test`
	for i := 0; i < 50; i++ {
		cachedRes := extractors.ExtractRegex(text, pattern, "$1$", 1, "FAIL")
		if cachedRes != "42" {
			t.Fatalf("Iteration %d: expected 42, got %s", i, cachedRes)
		}
	}
}
