package config

import (
	"strings"
	"testing"
)

func TestInferenceEffortsUsePublishedModelTiers(t *testing.T) {
	for _, tc := range []struct{ model, want string }{{"deepseek-flash", "low,high,max"}, {"claude-opus-4-5", "low,medium,high"}, {"claude-opus-4-6", "low,medium,high,max"}, {"claude-sonnet-4-6", "low,medium,high,max"}, {"claude-opus-5-5", "low,medium,high,xhigh,max"}, {"claude-haiku-5-5", "low,medium,high,xhigh,max"}, {"claude-3-5-sonnet", ""}, {"gpt-5", "minimal,low,medium,high"}, {"gpt-5-mini", "minimal,low,medium,high"}, {"gpt-5.1", "low,medium,high"}, {"gpt-5.4", "low,medium,high,xhigh"}, {"custom-model", ""}} {
		if got := strings.Join(InferenceEfforts(tc.model, ""), ","); got != tc.want {
			t.Errorf("%s=%s want %s", tc.model, got, tc.want)
		}
	}
	if !HasInferenceEffort(InferenceEfforts("custom-model", "custom-effort"), "custom-effort") {
		t.Fatal("explicit endpoint declaration was dropped")
	}
}
