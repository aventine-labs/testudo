package extractors

import (
	"fmt"
	"math/rand"
	"regexp"
	"strconv"
	"strings"
)

// ExtractRegex performs regular expression extraction matching JMeter template syntax ($1$, $2$).
func ExtractRegex(text, pattern, template string, matchNo int, defaultValue string) string {
	if text == "" || pattern == "" {
		return defaultValue
	}

	re, err := regexp.Compile(pattern)
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
	re, err := regexp.Compile(pattern)
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
