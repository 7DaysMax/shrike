package server

import (
	"fmt"
	"github.com/Autumn-27/shrike/db"
	"sync"
	"testing"
)

func TestLiveHubCumulativeReconnectAndIsolation(t *testing.T) {
	h := &liveHub{resources: map[string]*liveResource{}}
	ch, cancel := h.subscribe("task:1")
	defer cancel()
	h.publish("task:1", db.Activity{StreamID: "a", Streaming: true, Detail: "第"})
	h.publish("task:1", db.Activity{StreamID: "a", Streaming: true, Detail: "第一段"})
	<-ch
	s := h.snapshot("task:1")
	if len(s.Items) != 1 || s.Items[0].Detail != "第一段" {
		t.Fatalf("%+v", s)
	}
	h.publish("task:1", db.Activity{ID: 42, StreamID: "a", Detail: "第一段完成", Kind: "result"})
	s = h.snapshot("task:1")
	if len(s.Items) != 1 || s.Items[0].Streaming || s.Items[0].Seq != 42 {
		t.Fatal(s)
	}
	if len(h.snapshot("conversation:1").Items) != 0 {
		t.Fatal("cross scope leak")
	}
	t.Log("CUMULATIVE=true; RECONNECT_SNAPSHOT=true; SCOPES_ISOLATED=true")
}
func TestLiveHubConcurrentBounded(t *testing.T) {
	h := &liveHub{resources: map[string]*liveResource{}}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h.publish("task:1", db.Activity{ID: int64(i + 1), StreamID: fmt.Sprint(i), Detail: "committed"})
			_ = h.snapshot("task:1")
		}(i)
	}
	wg.Wait()
	if n := len(h.snapshot("task:1").Items); n > 24 {
		t.Fatal(n)
	}
}
