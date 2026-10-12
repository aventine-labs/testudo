package extractors

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
)

// ExtractJSON evaluates a JSONPath expression against a JSON string.
// Supported syntax:
//   - "$.token" or "token"
//   - "$.data.user.id" or "data.user.id"
//   - "$.items[0].id" or "items[0].id"
//   - "$[0].id" or "[0].id"
func ExtractJSON(jsonText, jsonPath string, matchNo int, defaultValue string) string {
	if strings.TrimSpace(jsonText) == "" || strings.TrimSpace(jsonPath) == "" {
		return defaultValue
	}

	var root interface{}
	if err := json.Unmarshal([]byte(jsonText), &root); err != nil {
		return defaultValue
	}

	// Normalize path by stripping leading "$." or "$"
	cleanPath := strings.TrimSpace(jsonPath)
	cleanPath = strings.TrimPrefix(cleanPath, "$.")
	cleanPath = strings.TrimPrefix(cleanPath, "$")

	tokens := tokenizeJSONPath(cleanPath)
	values := resolveJSONTokens(root, tokens)

	if len(values) == 0 {
		return defaultValue
	}

	var selected interface{}
	if matchNo == 1 {
		selected = values[0]
	} else if matchNo > 1 && matchNo <= len(values) {
		selected = values[matchNo-1]
	} else if matchNo == 0 {
		selected = values[rand.Intn(len(values))]
	} else if matchNo == -1 {
		// All matches as comma separated or first
		selected = values[0]
	} else {
		selected = values[0]
	}

	return stringifyJSONValue(selected)
}

func tokenizeJSONPath(path string) []string {
	var tokens []string
	var current strings.Builder

	inBracket := false
	for i := 0; i < len(path); i++ {
		ch := path[i]
		switch ch {
		case '.':
			if !inBracket {
				if current.Len() > 0 {
					tokens = append(tokens, current.String())
					current.Reset()
				}
			} else {
				current.WriteByte(ch)
			}
		case '[':
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			inBracket = true
			current.WriteByte(ch)
		case ']':
			inBracket = false
			current.WriteByte(ch)
			tokens = append(tokens, current.String())
			current.Reset()
		default:
			current.WriteByte(ch)
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func resolveJSONTokens(current interface{}, tokens []string) []interface{} {
	if len(tokens) == 0 {
		if current == nil {
			return nil
		}
		return []interface{}{current}
	}

	token := tokens[0]
	remaining := tokens[1:]

	if strings.HasPrefix(token, "[") && strings.HasSuffix(token, "]") {
		inner := token[1 : len(token)-1]
		if inner == "*" {
			// Wildcard across all array elements
			arr, ok := current.([]interface{})
			if !ok {
				return nil
			}
			var results []interface{}
			for _, item := range arr {
				res := resolveJSONTokens(item, remaining)
				results = append(results, res...)
			}
			return results
		}

		idx, err := strconv.Atoi(inner)
		if err != nil {
			return nil
		}

		arr, ok := current.([]interface{})
		if !ok || idx < 0 || idx >= len(arr) {
			return nil
		}
		return resolveJSONTokens(arr[idx], remaining)
	}

	// Object key lookup
	obj, ok := current.(map[string]interface{})
	if !ok {
		return nil
	}

	val, found := obj[token]
	if !found {
		return nil
	}

	return resolveJSONTokens(val, remaining)
}

func stringifyJSONValue(val interface{}) string {
	switch v := val.(type) {
	case string:
		return v
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		if v {
			return "true"
		}
		return "false"
	case nil:
		return ""
	default:
		bytes, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(bytes)
	}
}
