package extractors

import (
	"math/rand"
	"strings"
)

// ExtractBoundary performs left-and-right boundary string extraction matching JMeter semantics.
func ExtractBoundary(text, leftBoundary, rightBoundary string, matchNo int, defaultValue string) string {
	if text == "" {
		return defaultValue
	}

	matches := make([]string, 0)
	cursor := 0

	for {
		startIdx := 0
		if leftBoundary != "" {
			found := strings.Index(text[cursor:], leftBoundary)
			if found == -1 {
				break
			}
			startIdx = cursor + found + len(leftBoundary)
		} else {
			startIdx = cursor
		}

		endIdx := len(text)
		if rightBoundary != "" {
			found := strings.Index(text[startIdx:], rightBoundary)
			if found == -1 {
				break
			}
			endIdx = startIdx + found
		}

		matchVal := text[startIdx:endIdx]
		matches = append(matches, matchVal)

		if rightBoundary != "" {
			cursor = endIdx + len(rightBoundary)
		} else {
			break // reached end
		}

		if cursor >= len(text) {
			break
		}
	}

	if len(matches) == 0 {
		return defaultValue
	}

	// MatchNo: 1 is first match
	if matchNo == 1 {
		return matches[0]
	}
	if matchNo > 1 && matchNo <= len(matches) {
		return matches[matchNo-1]
	}
	if matchNo <= 0 {
		// Random match (JMeter behavior for 0 or negative when not array)
		idx := rand.Intn(len(matches))
		return matches[idx]
	}

	return defaultValue
}
