package agent

import (
	"context"
	"errors"
	"github.com/Autumn-27/norma/agentcore"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/shrike/db"
	"testing"
	"time"
)

func TestLiveCaptureBeforeTerminal(t *testing.T) {
	release := make(chan struct{})
	events := make(chan db.Activity, 16)
	done := make(chan error, 1)
	p := captureUsageProvider{stream: func(ctx context.Context, y func(llm.StreamEvent, error) bool) {
		if !y(llm.StreamEvent{Type: llm.SETextDelta, Text: "第一段"}, nil) {
			return
		}
		select {
		case <-release:
		case <-ctx.Done():
			return
		}
		if !y(llm.StreamEvent{Type: llm.SETextDelta, Text: "第二段"}, nil) {
			return
		}
		y(llm.StreamEvent{Type: llm.SEMessageDelta, StopReason: "end_turn"}, nil)
	}}
	ctx, cancel := context.WithTimeout(WithLiveCapture(context.Background()), 5*time.Second)
	defer cancel()
	go func() {
		_, _, e := captureRun(ctx, agentcore.Options{Provider: p, MaxTurns: 1}, "fixture", func(a db.Activity) { events <- a })
		done <- e
	}()
	var first db.Activity
	select {
	case first = <-events:
	case <-ctx.Done():
		t.Fatal("no frame before final reply")
	}
	if !first.Streaming || first.Detail != "第一段" || first.StreamID == "" {
		t.Fatalf("first=%+v", first)
	}
	select {
	case <-done:
		t.Fatal("provider completed before gate released")
	default:
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	close(events)
	n := 0
	for a := range events {
		if !a.Streaming && a.Kind == "result" {
			n++
			if a.Detail != "第一段第二段" || a.StreamID != first.StreamID {
				t.Fatalf("final=%+v", a)
			}
		}
	}
	if n != 1 {
		t.Fatalf("durable final count=%d", n)
	}
	t.Log("LIVE_BEFORE_FINAL=true; FINAL_SINGLE_ROW=true; STABLE_STREAM_ID=true")
}
func TestLiveCaptureCancelPreservesPartial(t *testing.T) {
	ready := make(chan struct{})
	events := make(chan db.Activity, 16)
	done := make(chan error, 1)
	p := captureUsageProvider{stream: func(ctx context.Context, y func(llm.StreamEvent, error) bool) {
		if !y(llm.StreamEvent{Type: llm.SETextDelta, Text: "保留部分输出"}, nil) {
			return
		}
		close(ready)
		<-ctx.Done()
		y(llm.StreamEvent{}, ctx.Err())
	}}
	ctx, cancel := context.WithCancel(WithLiveCapture(context.Background()))
	go func() {
		_, _, e := captureRun(ctx, agentcore.Options{Provider: p, MaxTurns: 1}, "fixture", func(a db.Activity) { events <- a })
		done <- e
	}()
	<-ready
	cancel()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	close(events)
	found := false
	for a := range events {
		if !a.Streaming && a.Kind == "text" && a.Detail == "保留部分输出" {
			found = true
		}
	}
	if !found {
		t.Fatal("cancel lost partial text")
	}
	t.Log("STOP_PRESERVES_PARTIAL=true")
}
