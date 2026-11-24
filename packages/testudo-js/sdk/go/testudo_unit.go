// Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic Go SDK
// File: packages/testudo-js/sdk/go/testudo_unit.go
// Strict Rule 6: Zero em-dashes and zero en-dashes.

package testudounit

import (
	"encoding/json"
	"fmt"
	"math"
	"time"
)

type ContractField struct {
	Name               string `json:"name"`
	BitIndex           uint   `json:"bitIndex"`
	Type               string `json:"type"`
	RequiredByFrontend bool   `json:"requiredByFrontend"`
}

type ContractCassette struct {
	RequiredFieldMask uint32          `json:"requiredFieldMask"`
	Fields            []ContractField `json:"fields"`
}

type TwepRecord struct {
	Twep             int    `json:"twep"`
	Lang             string `json:"lang"`
	Tier             string `json:"tier"`
	Suite            string `json:"suite"`
	Name             string `json:"name"`
	Ok               bool   `json:"ok"`
	DurationUs       int64  `json:"durationUs"`
	Assertions       int    `json:"assertions"`
	CassetteVerified bool   `json:"cassetteVerified"`
	Error            string `json:"error,omitempty"`
}

func classifyGoValue(v any) string {
	if v == nil {
		return "null"
	}
	switch v.(type) {
	case bool:
		return "boolean"
	case int, int32, int64, uint, uint32, uint64, float32, float64:
		return "number"
	case string:
		return "string"
	case []any:
		return "array"
	default:
		return "object"
	}
}

func VerifyBackendCassette(c ContractCassette, payload map[string]any) int {
	var emittedMask uint32
	mismatches := 0
	for _, f := range c.Fields {
		if val, ok := payload[f.Name]; ok {
			emittedMask |= (1 << f.BitIndex)
			if classifyGoValue(val) != f.Type {
				mismatches++
			}
		}
	}
	if (c.RequiredFieldMask&emittedMask) != c.RequiredFieldMask || mismatches > 0 {
		return -9861
	}
	return 1
}

func AssertCurrencyCents(actualCents int64, expectedCents int64, tolCents int64) error {
	if int64(math.Abs(float64(actualCents-expectedCents))) > tolCents {
		return fmt.Errorf("currency mismatch: %d vs %d cents", actualCents, expectedCents)
	}
	return nil
}

func PropInt64(minVal int64, maxVal int64, runs int, pred func(int64) bool) error {
	var state uint64 = 0x517CC1B727220A95
	span := uint64(maxVal - minVal + 1)
	if span == 0 {
		span = 1
	}
	edges := []int64{0, 1, -1, minVal, maxVal}
	count := 0
	for _, e := range edges {
		if e >= minVal && e <= maxVal {
			count++
			if !pred(e) {
				return fmt.Errorf("property falsified on edge %d", e)
			}
		}
	}
	for count < runs {
		state ^= state << 13
		state ^= state >> 7
		state ^= state << 17
		sample := minVal + int64(state%span)
		count++
		if !pred(sample) {
			return fmt.Errorf("property falsified on sample %d", sample)
		}
	}
	return nil
}

func RunCase(suite string, name string, cassetteVerified bool, fn func() (int, error)) bool {
	t0 := time.Now()
	assertions, err := fn()
	durUs := time.Since(t0).Microseconds()
	if durUs < 1 {
		durUs = 1
	}
	rec := TwepRecord{
		Twep:             1,
		Lang:             "go",
		Tier:             "unit",
		Suite:            suite,
		Name:             name,
		Ok:               err == nil,
		DurationUs:       durUs,
		Assertions:       assertions,
		CassetteVerified: cassetteVerified,
	}
	if err != nil {
		rec.Error = err.Error()
	}
	b, _ := json.Marshal(rec)
	fmt.Println(string(b))
	return err == nil
}
