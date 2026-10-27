package llmrec

import "context"

type InferenceOptions struct {
	ThinkingType    string
	ReasoningEffort string
}
type inferenceKey struct{}

func WithInference(ctx context.Context, o InferenceOptions) context.Context {
	return context.WithValue(ctx, inferenceKey{}, o)
}
func InferenceFrom(ctx context.Context) InferenceOptions {
	if ctx == nil {
		return InferenceOptions{}
	}
	v, _ := ctx.Value(inferenceKey{}).(InferenceOptions)
	return v
}
