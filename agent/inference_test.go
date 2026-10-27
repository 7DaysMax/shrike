package agent

import (
	"context"
	"encoding/json"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/shrike/llmrec"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestInferenceWireMappingAndCapture(t *testing.T) {
	for _, tc := range []struct {
		name, format, path, model, thinking, effort string
		want                                        map[string]any
		absent                                      string
	}{{"deepseek", "openai", "/chat/completions", "deepseek-flash", "enabled", "max", map[string]any{"reasoning_effort": "max", "thinking": map[string]any{"type": "enabled"}}, ""}, {"deepseek-off", "openai", "/chat/completions", "deepseek-flash", "disabled", "", map[string]any{"thinking": map[string]any{"type": "disabled"}}, "reasoning_effort"}, {"anthropic", "anthropic", "/messages", "claude-opus-4-6", "enabled", "max", map[string]any{"output_config": map[string]any{"effort": "max"}, "thinking": map[string]any{"type": "adaptive"}}, ""}, {"responses", "openai-responses", "/responses", "gpt-5.4", "enabled", "xhigh", map[string]any{"reasoning": map[string]any{"effort": "xhigh"}}, "thinking"}, {"gpt-off", "openai", "/chat/completions", "gpt-5.4", "disabled", "", map[string]any{"reasoning_effort": "none"}, "thinking"}} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				w.Header().Set("Content-Type", "application/json")
				w.Write(b)
			}))
			defer srv.Close()
			client, e := quotaAwareHTTPClient("", "", nil)
			if e != nil {
				t.Fatal(e)
			}
			client.Transport = inferenceTransport{base: client.Transport, format: tc.format}
			payload := `{"model":"` + tc.model + `","reasoning_effort":"low","thinking":{"type":"disabled"},"sentinel":9007199254740993}`
			r, _ := http.NewRequest("POST", srv.URL+tc.path, strings.NewReader(payload))
			ctx, capture := llmrec.NewCapture(llmrec.WithInference(r.Context(), llmrec.InferenceOptions{ThinkingType: tc.thinking, ReasoningEffort: tc.effort}))
			r = r.WithContext(ctx)
			res, e := client.Do(r)
			if e != nil {
				t.Fatal(e)
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			var actual map[string]any
			json.Unmarshal(body, &actual)
			for key, want := range tc.want {
				a, _ := json.Marshal(actual[key])
				b, _ := json.Marshal(want)
				if string(a) != string(b) {
					t.Fatalf("%s=%s want %s; %s", key, a, b, body)
				}
			}
			if tc.absent != "" && actual[tc.absent] != nil {
				t.Fatal("unexpected", tc.absent, string(body))
			}
			if !strings.Contains(string(body), "9007199254740993") {
				t.Fatal("numeric input changed")
			}
			if capture.RawRequest() != string(body) {
				t.Fatal("recorder missed effective wire settings")
			}
			b, _ := r.GetBody()
			old, _ := io.ReadAll(b)
			b.Close()
			if string(old) != payload {
				t.Fatal("shared request was mutated")
			}
		})
	}
}
func TestInferenceProviderRemainsScopedUnderConcurrency(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"fixture","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer srv.Close()
	cfg := ConfigFrom("openai", "deepseek-flash", srv.URL, "fixture", "")
	cfg.ReasoningEffort = "low"
	p, e := cfg.NewProvider()
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			effort := "high"
			if i%2 == 0 {
				effort = "max"
			}
			ctx, capture := llmrec.NewCapture(llmrec.WithInference(context.Background(), llmrec.InferenceOptions{ThinkingType: "enabled", ReasoningEffort: effort}))
			if _, _, _, e := p.Complete(ctx, llm.CompletionRequest{}); e != nil {
				t.Error(e)
				return
			}
			var body map[string]any
			json.Unmarshal([]byte(capture.RawRequest()), &body)
			if body["reasoning_effort"] != effort {
				t.Error("cross-conversation option leak", body)
			}
		}(i)
	}
	wg.Wait()
	ctx, capture := llmrec.NewCapture(context.Background())
	if _, _, _, e = p.Complete(ctx, llm.CompletionRequest{}); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(capture.RawRequest(), `"reasoning_effort":"low"`) {
		t.Fatal("profile default was mutated", capture.RawRequest())
	}
}
func TestInferencePreservesForcedThinkingOff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`))
	}))
	defer srv.Close()
	cfg := ConfigFrom("openai", "deepseek-flash", srv.URL, "fixture", "")
	p, e := cfg.NewProvider()
	if e != nil {
		t.Fatal(e)
	}
	ctx, capture := llmrec.NewCapture(llmrec.WithInference(context.Background(), llmrec.InferenceOptions{ThinkingType: "enabled", ReasoningEffort: "max"}))
	if _, _, _, e = p.Complete(ctx, llm.CompletionRequest{Thinking: "disabled"}); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(capture.RawRequest(), `"type":"disabled"`) {
		t.Fatal("compaction's forced-off was lost", capture.RawRequest())
	}
}
func TestInferenceFailoverUsesCompatibleProviderDefault(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { b, _ := io.ReadAll(r.Body); w.Write(b) }))
	defer srv.Close()
	client, _ := quotaAwareHTTPClient("", "", nil)
	client.Transport = inferenceTransport{base: client.Transport, format: "openai"}
	r, _ := http.NewRequest("POST", srv.URL, strings.NewReader(`{"model":"gpt-5.4","reasoning_effort":"high"}`))
	r = r.WithContext(llmrec.WithInference(r.Context(), llmrec.InferenceOptions{ThinkingType: "enabled", ReasoningEffort: "max"}))
	res, e := client.Do(r)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), `"reasoning_effort":"high"`) {
		t.Fatal("unsupported inherited tier replaced the provider default", string(body))
	}
}
