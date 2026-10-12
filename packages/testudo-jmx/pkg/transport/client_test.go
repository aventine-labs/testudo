package transport_test

import (
	"testing"

	"aventinelabs.com/testudo-jmx/pkg/transport"
)

func TestBuildFullURL(t *testing.T) {
	// 1. Standard component-based URL
	u1 := transport.BuildFullURL("http", "example.com", 8080, "/api/v1", map[string]string{"q": "test"})
	if u1 != "http://example.com:8080/api/v1?q=test" {
		t.Errorf("Unexpected standard URL: %s", u1)
	}

	// 2. Full URL directly in path (URL-based script)
	fullURL := "https://api.aventinelabs.com/checkout/order"
	u2 := transport.BuildFullURL("", "", 0, fullURL, nil)
	if u2 != fullURL {
		t.Errorf("Expected full URL %s, got %s", fullURL, u2)
	}

	// 3. Full URL with query arguments appended
	u3 := transport.BuildFullURL("", "", 0, fullURL, map[string]string{"ref": "jmeter"})
	if u3 != "https://api.aventinelabs.com/checkout/order?ref=jmeter" {
		t.Errorf("Unexpected URL with query args: %s", u3)
	}

	// 4. Default ports omitted in standard URLs
	u4 := transport.BuildFullURL("https", "example.com", 443, "status", nil)
	if u4 != "https://example.com/status" {
		t.Errorf("Expected port 443 omitted: %s", u4)
	}
}
