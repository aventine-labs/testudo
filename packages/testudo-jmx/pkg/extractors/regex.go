package extractors

import (
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

const (
	// MaxSafePatternLength bounds input length to eliminate catastrophic memory consumption
	MaxSafePatternLength = 8192
	// MaxRegexCacheEntries limits memory consumption of compiled regex automata
	MaxRegexCacheEntries = 1000
)

var (
	regexCacheMu sync.RWMutex
	regexCache   = make(map[string]*regexp.Regexp)
)

// compileSafeRegex enforces bounds checking, bounds state compilation,
// and caches compiled linear-time RE2 automata.
func compileSafeRegex(pattern string) (*regexp.Regexp, error) {
	if len(pattern) == 0 {
		return nil, fmt.Errorf("empty regex pattern")
	}
	if len(pattern) > MaxSafePatternLength {
		return nil, fmt.Errorf("pattern length %d exceeds safe boundary of %d bytes", len(pattern), MaxSafePatternLength)
	}

	regexCacheMu.RLock()
	cached, found := regexCache[pattern]
	regexCacheMu.RUnlock()
	if found {
		return cached, nil
	}

	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}

	regexCacheMu.Lock()
	if len(regexCache) < MaxRegexCacheEntries {
		regexCache[pattern] = re
	}
	regexCacheMu.Unlock()

	return re, nil
}

// ExtractRegex performs regular expression extraction matching JMeter template syntax ($1$, $2$).
func ExtractRegex(text, pattern, template string, matchNo int, defaultValue string) string {
	if text == "" || pattern == "" {
		return defaultValue
	}

	re, err := compileSafeRegex(pattern)
	if err != nil {
		return defaultValue
	}

	allMatches := re.FindAllStringSubmatch(text, -1)
	if len(allMatches) == 0 {
		return defaultValue
	}

	targetMatch := []string{}
	if matchNo == 1 {
		targetMatch = allMatches[0]
	} else if matchNo > 1 && matchNo <= len(allMatches) {
		targetMatch = allMatches[matchNo-1]
	} else if matchNo <= 0 {
		targetMatch = allMatches[rand.Intn(len(allMatches))]
	} else {
		return defaultValue
	}

	if template == "" {
		template = "$1$"
	}

	// Substitute template: $0$ is full match, $1$ is group 1, etc.
	// Supports both $1$ and $1 formats
	result := template
	for i, groupVal := range targetMatch {
		tokenWithDollar := fmt.Sprintf("$%d$", i)
		result = strings.ReplaceAll(result, tokenWithDollar, groupVal)
		tokenSingle := fmt.Sprintf("$%d", i)
		result = strings.ReplaceAll(result, tokenSingle, groupVal)
	}

	// Clean any unresolved tokens like $2$ or $2
	for i := len(targetMatch); i < 10; i++ {
		tokenWithDollar := fmt.Sprintf("$%d$", i)
		result = strings.ReplaceAll(result, tokenWithDollar, "")
		tokenSingle := fmt.Sprintf("$%d", i)
		result = strings.ReplaceAll(result, tokenSingle, "")
	}

	// If no replacement occurred, return group 1 if present
	if result == template && len(targetMatch) > 1 {
		return targetMatch[1]
	}

	return result
}

// ExtractMultiRegex extracts all matches and populates ref_1, ref_2, ref_matchNr in variables map.
func ExtractMultiRegex(text, pattern, template, refName string, vars map[string]string) {
	re, err := compileSafeRegex(pattern)
	if err != nil {
		return
	}

	allMatches := re.FindAllStringSubmatch(text, -1)
	vars[refName+"_matchNr"] = strconv.Itoa(len(allMatches))

	for i, match := range allMatches {
		idx := i + 1
		res := template
		for g, gVal := range match {
			res = strings.ReplaceAll(res, fmt.Sprintf("$%d$", g), gVal)
		}
		vars[fmt.Sprintf("%s_%d", refName, idx)] = res
	}
}
