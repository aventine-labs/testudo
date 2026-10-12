package reporting

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunRegistryLifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test_runs.json")

	reg := &RunRegistry{
		filePath: dbPath,
		runs:     make([]RunRecord, 0),
	}
	reg.load()

	runs := reg.ListRuns()
	if len(runs) == 0 {
		t.Fatalf("expected pre-seeded runs, got 0")
	}

	testRun := RunRecord{
		ID:             "run_test_custom",
		Timestamp:      "2026-10-03 12:00:00",
		ScenarioName:   "Custom Automated Test Scenario",
		DurationSec:    60.0,
		TargetVUs:      5000,
		TotalRequests:  125000,
		TotalErrors:    0,
		ErrorRatePct:   0.0,
		RequestsPerSec: 2083.3,
		LatencyP50Ms:   2.4,
		LatencyP90Ms:   5.1,
		LatencyP99Ms:   9.8,
		StatusCodes:    map[string]int64{"200": 125000},
		SlaStatus:      "PASS",
	}

	reg.AddRun(testRun)

	retrieved, found := reg.GetRun("run_test_custom")
	if !found {
		t.Fatalf("expected to find run_test_custom")
	}
	if retrieved.TargetVUs != 5000 {
		t.Errorf("expected TargetVUs 5000, got %d", retrieved.TargetVUs)
	}

	csv, err := reg.GenerateJTLCSV("run_test_custom")
	if err != nil {
		t.Fatalf("failed to generate JTL CSV: %v", err)
	}
	if len(csv) == 0 {
		t.Errorf("expected non-empty JTL CSV")
	}

	// Verify persistence to disk
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Errorf("expected db file %s to exist on disk", dbPath)
	}
}
