package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/shrike/config"
	"github.com/Autumn-27/shrike/llmrec"
	"io"
	"iter"
	"net/http"
	"strings"
)

// Context-only overrides preserve the provider's existing pool and rate limiter.
type inferenceProvider struct{ inner llm.Provider }

func (p inferenceProvider) Stream(ctx context.Context, r llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	o := llmrec.InferenceFrom(ctx)
	if r.Thinking != "" {
		o.ThinkingType = r.Thinking
		o.ReasoningEffort = ""
		ctx = llmrec.WithInference(ctx, o)
	} else if o.ThinkingType != "" {
		r.Thinking = o.ThinkingType
		if r.Thinking == "adaptive" {
			r.Thinking = "enabled"
		}
	}
	return p.inner.Stream(ctx, r)
}
func (p inferenceProvider) Complete(ctx context.Context, r llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	o := llmrec.InferenceFrom(ctx)
	if r.Thinking != "" {
		o.ThinkingType = r.Thinking
		o.ReasoningEffort = ""
		ctx = llmrec.WithInference(ctx, o)
	} else if o.ThinkingType != "" {
		r.Thinking = o.ThinkingType
		if r.Thinking == "adaptive" {
			r.Thinking = "enabled"
		}
	}
	return p.inner.Complete(ctx, r)
}

type inferenceTransport struct {
	base   http.RoundTripper
	format string
}

func (t inferenceTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	o := llmrec.InferenceFrom(r.Context())
	if (o.ThinkingType == "" && o.ReasoningEffort == "") || r.Method != "POST" || r.Body == nil {
		return t.base.RoundTrip(r)
	}
	var reader io.ReadCloser
	var e error
	if r.GetBody != nil {
		reader, e = r.GetBody()
	} else {
		reader = r.Body
	}
	if e != nil {
		return nil, e
	}
	defer reader.Close()
	defer r.Body.Close()
	body, e := io.ReadAll(io.LimitReader(reader, 32<<20+1))
	if e != nil {
		return nil, e
	}
	if len(body) > 32<<20 {
		return nil, fmt.Errorf("inference request exceeds 32 MiB")
	}
	var data map[string]json.RawMessage
	if e = json.Unmarshal(body, &data); e != nil {
		return nil, e
	}
	if data == nil {
		return nil, fmt.Errorf("invalid inference body")
	}
	var model string
	json.Unmarshal(data["model"], &model)
	set := func(key string, value any) { b, _ := json.Marshal(value); data[key] = b }
	object := func(key string) map[string]any {
		m := map[string]any{}
		json.Unmarshal(data[key], &m)
		if m == nil {
			m = map[string]any{}
		}
		return m
	}
	effort := o.ReasoningEffort
	off := o.ThinkingType == "disabled" || effort == "none"
	anthropic := strings.Contains(t.format, "anthropic")
	responses := strings.Contains(r.URL.Path, "responses")
	openAIModel := strings.HasPrefix(model, "gpt-") || strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4")
	deepseek := strings.Contains(strings.ToLower(model), "deepseek")
	var configured string
	if anthropic {
		m := object("output_config")
		configured, _ = m["effort"].(string)
	} else if responses {
		m := object("reasoning")
		configured, _ = m["effort"].(string)
	} else {
		json.Unmarshal(data["reasoning_effort"], &configured)
	}
	if effort != "" && effort != "none" && !config.HasInferenceEffort(config.InferenceEfforts(model, configured), effort) {
		effort = ""
	}

	if anthropic {
		if o.ThinkingType == "enabled" && strings.Contains(model, "claude") && (strings.Contains(model, "4-6") || strings.Contains(model, "4.6") || strings.Contains(model, "4-7") || strings.Contains(model, "4.7") || strings.Contains(model, "4-8") || strings.Contains(model, "4.8") || strings.Contains(model, "opus-5") || strings.Contains(model, "sonnet-5") || strings.Contains(model, "haiku-5") || strings.Contains(model, "fable-5") || strings.Contains(model, "mythos-5")) {
			o.ThinkingType = "adaptive"
		}
		if o.ThinkingType != "" {
			thinking := map[string]any{"type": o.ThinkingType}
			if o.ThinkingType == "enabled" && strings.Contains(model, "claude") {
				var limit int
				json.Unmarshal(data["max_tokens"], &limit)
				if limit == 0 {
					limit = 8192
				}
				budget := limit / 2
				if budget > 4096 {
					budget = 4096
				}
				if budget < 1024 {
					return nil, fmt.Errorf("开启思考需要输出上限至少 2048 tokens")
				}
				thinking["budget_tokens"] = budget
			}
			set("thinking", thinking)
		}
		if effort != "" {
			if effort == "none" {
				delete(data, "output_config")
			} else {
				m := object("output_config")
				m["effort"] = effort
				set("output_config", m)
			}
		}
	} else if responses {
		m := object("reasoning")
		if effort != "" {
			m["effort"] = effort
		}
		if off {
			m["effort"] = "none"
		}
		if len(m) > 0 {
			set("reasoning", m)
		}
		delete(data, "thinking")
	} else {
		if effort != "" {
			set("reasoning_effort", effort)
		}
		if openAIModel {
			delete(data, "thinking")
			if off {
				set("reasoning_effort", "none")
			}
		} else if o.ThinkingType != "" {
			set("thinking", map[string]any{"type": o.ThinkingType})
		}
		if deepseek && off {
			set("thinking", map[string]any{"type": "disabled"})
			delete(data, "reasoning_effort")
		}
	}
	body, e = json.Marshal(data)
	if e != nil {
		return nil, e
	}
	clone := r.Clone(r.Context())
	clone.Header = r.Header.Clone()
	clone.Body = io.NopCloser(bytes.NewReader(body))
	clone.ContentLength = int64(len(body))
	clone.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	return t.base.RoundTrip(clone)
}
