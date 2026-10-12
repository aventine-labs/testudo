package extractors

import (
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"sync"
)

const (
	// MaxSafePatternLength bounds input length to eliminate catastrophic memory consumption
	MaxSafePatternLength = 8192
	// MaxRegexCacheEntries limits memory consumption of compiled regex automata
	MaxRegexCacheEntries = 1000
)

var (
	regexCacheMu    sync.RWMutex
	regexCache      = make(map[string]*regexp.Regexp)
	templateTokenRe = regexp.MustCompile(`\$([0-9]+)\$`)
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

	var targetMatch []string
	if matchNo == 1 {
		targetMatch = allMatches[0]
	} else if matchNo > 1 && matchNo <= len(allMatches) {
		targetMatch = allMatches[matchNo-1]
	} else if matchNo == 0 {
		// In JMeter, matchNo 0 means select randomly
		targetMatch = allMatches[rand.Intn(len(allMatches))]
	} else if matchNo < 0 {
		// When called directly without Multi, pick first
		targetMatch = allMatches[0]
	} else {
		return defaultValue
	}

	if template == "" {
		if len(targetMatch) > 1 {
			return targetMatch[1]
		}
		return targetMatch[0]
	}

	// Substitute tokens ($0$, $1$, $1, etc.) specifically within the template string.
	// We do not perform sweeping string replacements on the final output to preserve
	// currency symbols or literal $n text contained in extracted values.
	hasTokens := templateTokenRe.MatchString(template)
	if !hasTokens {
		// Literal template (e.g. "fixed") returns the literal template string matching JMeter
		return template
	}

	result := templateTokenRe.ReplaceAllStringFunc(template, func(token string) string {
		sub := templateTokenRe.FindStringSubmatch(token)
		if len(sub) < 2 {
			return ""
		}
		grpIdx, err := strconv.Atoi(sub[1])
		if err != nil {
			return ""
		}
		if grpIdx < len(targetMatch) {
			return targetMatch[grpIdx]
		}
		return ""
	})

	return result
}

// ExtractMultiRegex extracts all matches and populates ref_1, ref_2, ref_matchNr in variables map.
func ExtractMultiRegex(text, pattern, template, refName string, vars map[string]string) {
	if text == "" || pattern == "" || vars == nil {
		return
	}

	re, err := compileSafeRegex(pattern)
	if err != nil {
		vars[refName+"_matchNr"] = "0"
		return
	}

	allMatches := re.FindAllStringSubmatch(text, -1)

	// Clean up stale ref_N variables from any prior extractions with more matches
	if prevStr, ok := vars[refName+"_matchNr"]; ok {
		if prevNr, err := strconv.Atoi(prevStr); err == nil {
			for k := len(allMatches) + 1; k <= prevNr; k++ {
				delete(vars, fmt.Sprintf("%s_%d", refName, k))
			}
		}
	}
	for k := len(allMatches) + 1; ; k++ {
		key := fmt.Sprintf("%s_%d", refName, k)
		if _, exists := vars[key]; !exists {
			break
		}
		delete(vars, key)
	}

	vars[refName+"_matchNr"] = strconv.Itoa(len(allMatches))

	effectiveTemplate := template
	if effectiveTemplate == "" {
		effectiveTemplate = "$1$"
	}

	for i, match := range allMatches {
		idx := i + 1
		hasTokens := templateTokenRe.MatchString(effectiveTemplate)
		var val string
		if !hasTokens {
			val = effectiveTemplate
		} else {
			val = templateTokenRe.ReplaceAllStringFunc(effectiveTemplate, func(token string) string {
				sub := templateTokenRe.FindStringSubmatch(token)
				if len(sub) < 2 {
					return ""
				}
				grpIdx, err := strconv.Atoi(sub[1])
				if err != nil {
					return ""
				}
				if grpIdx < len(match) {
					return match[grpIdx]
				}
				return ""
			})
		}
		vars[fmt.Sprintf("%s_%d", refName, idx)] = val
	}
}
