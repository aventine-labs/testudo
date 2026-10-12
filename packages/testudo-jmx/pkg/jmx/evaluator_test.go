package jmx_test

import (
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/jmx"
)

func TestEvaluateString_SinglePassNoRecursiveExpansion(t *testing.T) {
	// Set a sensitive global property
	jmx.SetProperty("API_SECRET", "SUPER_CONFIDENTIAL_TOKEN_12345")

	// 1. Variable contains literal property reference (e.g. from extracted response body)
	vars := map[string]string{
		"extracted_resp": "User payload with ${__P(API_SECRET)} inside",
		"price_template": "item cost is ${amount}",
		"amount":         "99",
	}

	// In single-pass evaluation, ${extracted_resp} should expand to its literal value,
	// and NEVER re-evaluate the inner ${__P(API_SECRET)}.
	result := jmx.EvaluateString("${extracted_resp}", vars, 1)
	expected := "User payload with ${__P(API_SECRET)} inside"
	if result != expected {
		t.Fatalf("Recursive evaluation vulnerability detected! Expected literal '%s', got '%s'", expected, result)
	}

	// 2. Variable contains nested ${amount}, which should also NOT be expanded when referencing ${price_template}
	resultTemplate := jmx.EvaluateString("${price_template}", vars, 1)
	expectedTemplate := "item cost is ${amount}"
	if resultTemplate != expectedTemplate {
		t.Fatalf("Recursive evaluation detected! Expected '%s', got '%s'", expectedTemplate, resultTemplate)
	}

	// 3. Normal multi-variable template evaluates left-to-right in single pass
	vars["HOST"] = "localhost"
	vars["PORT"] = "8080"
	normalResult := jmx.EvaluateString("http://${HOST}:${PORT}/api/v1", vars, 1)
	expectedNormal := "http://localhost:8080/api/v1"
	if normalResult != expectedNormal {
		t.Fatalf("Single pass multi-variable evaluation failed: expected '%s', got '%s'", expectedNormal, normalResult)
	}
}

func TestOrderedVariables_DeclarationOrder(t *testing.T) {
	// Test that sequential declaration order allows chained variable dependencies
	ordered := []jmx.Argument{
		{Name: "PROTOCOL", Value: "https"},
		{Name: "DOMAIN", Value: "api.aventinelabs.com"},
		{Name: "BASE_URL", Value: "${PROTOCOL}://${DOMAIN}"},
		{Name: "FULL_ENDPOINT", Value: "${BASE_URL}/v2/checkout"},
	}

	vars := make(map[string]string)
	for _, arg := range ordered {
		vars[arg.Name] = jmx.EvaluateString(arg.Value, vars, 1)
	}

	if vars["BASE_URL"] != "https://api.aventinelabs.com" {
		t.Errorf("Expected BASE_URL https://api.aventinelabs.com, got %s", vars["BASE_URL"])
	}
	if vars["FULL_ENDPOINT"] != "https://api.aventinelabs.com/v2/checkout" {
		t.Errorf("Expected FULL_ENDPOINT https://api.aventinelabs.com/v2/checkout, got %s", vars["FULL_ENDPOINT"])
	}
}
