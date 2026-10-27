package agent

import "context"

type liveCaptureKey struct{}

// WithLiveCapture opts a UI sink into ephemeral cumulative snapshots. Persisted
// activity still consists of the same coalesced rows and final result as before.
func WithLiveCapture(ctx context.Context) context.Context {
	return context.WithValue(ctx, liveCaptureKey{}, true)
}
func liveCapture(ctx context.Context) bool { v, _ := ctx.Value(liveCaptureKey{}).(bool); return v }
