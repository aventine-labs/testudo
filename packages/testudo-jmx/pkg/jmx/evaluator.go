package jmx

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	globalCounter    uint64
	propMu           sync.RWMutex
	globalProperties = make(map[string]string)
)

// SetProperty sets a runtime property (e.g. from -J, -G, -D flags).
func SetProperty(key, value string) {
	propMu.Lock()
	defer propMu.Unlock()
	globalProperties[key] = value
}

// GetProperty retrieves a runtime property.
func GetProperty(key string) (string, bool) {
	propMu.RLock()
	defer propMu.RUnlock()
	v, ok := globalProperties[key]
	return v, ok
}

// GetAllProperties returns a copy of all active runtime properties.
func GetAllProperties() map[string]string {
	propMu.RLock()
	defer propMu.RUnlock()
	res := make(map[string]string, len(globalProperties))
	for k, v := range globalProperties {
		res[k] = v
	}
	return res
}

// EvaluateString resolves ${var_name} and built-in functions from session variables.
func EvaluateString(template string, vars map[string]string, threadID int) string {
	curr := template
	for pass := 0; pass < 5; pass++ {
		if !strings.Contains(curr, "${") {
			return curr
		}

		var sb strings.Builder
		pos := 0
		hasChange := false

		for pos < len(curr) {
			start := strings.Index(curr[pos:], "${")
			if start == -1 {
				sb.WriteString(curr[pos:])
				break
			}
			start += pos
			sb.WriteString(curr[pos:start])

			end := strings.Index(curr[start+2:], "}")
			if end == -1 {
				sb.WriteString(curr[start:])
				break
			}
			end = start + 2 + end

			expr := curr[start+2 : end]
			replacement := resolveExpression(expr, vars, threadID)
			if replacement != "${"+expr+"}" {
				hasChange = true
			}
			sb.WriteString(replacement)

			pos = end + 1
		}

		curr = sb.String()
		if !hasChange {
			break
		}
	}

	return curr
}

func resolveExpression(expr string, vars map[string]string, threadID int) string {
	expr = strings.TrimSpace(expr)

	// Check built-in functions: prefix "__"
	if strings.HasPrefix(expr, "__") {
		return evaluateBuiltinFunction(expr, threadID)
	}

	// Session variable lookup
	if val, ok := vars[expr]; ok {
		return val
	}

	// Default fallback: return unchanged or empty
	return "${" + expr + "}"
}

func evaluateBuiltinFunction(fnExpr string, threadID int) string {
	// Parse function name and arguments
	openParen := strings.Index(fnExpr, "(")
	closeParen := strings.LastIndex(fnExpr, ")")

	fnName := fnExpr
	args := []string{}
	if openParen != -1 && closeParen != -1 && closeParen > openParen {
		fnName = fnExpr[:openParen]
		argStr := fnExpr[openParen+1 : closeParen]
		if len(strings.TrimSpace(argStr)) > 0 {
			for _, arg := range strings.Split(argStr, ",") {
				args = append(args, strings.TrimSpace(arg))
			}
		}
	}

	switch strings.ToLower(fnName) {
	case "__time":
		if len(args) == 0 {
			return strconv.FormatInt(time.Now().UnixMilli(), 10)
		}
		format := args[0]
		if format == "YMD" || format == "yyyy-MM-dd" {
			return time.Now().Format("2006-01-02")
		}
		return time.Now().Format("2006-01-02 15:04:05")

	case "__threadnum":
		return strconv.Itoa(threadID)

	case "__uuid":
		return generateUUIDv4()

	case "__counter":
		val := atomic.AddUint64(&globalCounter, 1)
		return strconv.FormatUint(val, 10)

	case "__random":
		if len(args) >= 2 {
			min, err1 := strconv.ParseInt(args[0], 10, 64)
			max, err2 := strconv.ParseInt(args[1], 10, 64)
			if err1 == nil && err2 == nil && max > min {
				diff := max - min + 1
				n, _ := rand.Int(rand.Reader, big.NewInt(diff))
				return strconv.FormatInt(min+n.Int64(), 10)
			}
		}
		return "1"

	case "__p", "__property":
		if len(args) == 0 {
			return "1"
		}
		propName := args[0]
		if val, exists := GetProperty(propName); exists {
			return val
		}
		if len(args) >= 2 {
			return args[1]
		}
		return "1"

	default:
		return "${" + fnExpr + "}"
	}
}

func generateUUIDv4() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	buf[6] = (buf[6] & 0x0f) | 0x40 // Version 4
	buf[8] = (buf[8] & 0x3f) | 0x80 // Variant RFC 4122
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%12x",
		buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}
