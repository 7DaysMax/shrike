package config

import "strings"

// Published effort vocabularies. A manually configured default is retained as
// an endpoint-owned declaration; unknown models do not acquire invented tiers.
func InferenceEfforts(model, configured string) []string {
	model = strings.ToLower(model)
	var levels []string
	switch {
	case strings.Contains(model, "deepseek") && (strings.Contains(model, "v4") || strings.Contains(model, "flash") || strings.Contains(model, "pro")):
		levels = []string{"low", "high", "max"}
	case strings.Contains(model, "claude"):
		five := false
		for _, family := range []string{"opus", "sonnet", "haiku", "fable", "mythos"} {
			five = five || strings.Contains(model, family+"-5")
		}
		modern := five || strings.Contains(model, "mythos-preview") || strings.Contains(model, "4-6") || strings.Contains(model, "4.6") || strings.Contains(model, "4-7") || strings.Contains(model, "4.7") || strings.Contains(model, "4-8") || strings.Contains(model, "4.8")
		legacyEffort := strings.Contains(model, "opus-4-5") || strings.Contains(model, "opus-4.5")
		if modern || legacyEffort {
			levels = []string{"low", "medium", "high"}
		}
		if modern {
			if five || strings.Contains(model, "4-7") || strings.Contains(model, "4.7") || strings.Contains(model, "4-8") || strings.Contains(model, "4.8") {
				levels = append(levels, "xhigh")
			}
			levels = append(levels, "max")
		}
	case strings.HasPrefix(model, "gpt-5") || strings.HasPrefix(model, "gpt-6"):
		levels = []string{"low", "medium", "high"}
		if (strings.HasPrefix(model, "gpt-5.") && !strings.HasPrefix(model, "gpt-5.1")) || strings.HasPrefix(model, "gpt-6") {
			levels = append(levels, "xhigh")
		} else if !strings.HasPrefix(model, "gpt-5.1") {
			levels = append([]string{"minimal"}, levels...)
		}
	case strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4"):
		levels = []string{"low", "medium", "high"}
	}
	if configured != "" && !HasInferenceEffort(levels, configured) {
		levels = append(levels, configured)
	}
	return levels
}
func HasInferenceEffort(levels []string, value string) bool {
	for _, level := range levels {
		if level == value {
			return true
		}
	}
	return false
}
