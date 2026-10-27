package server

import (
	"encoding/json"
	"fmt"
	"github.com/Autumn-27/shrike/db"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type liveSnapshot struct {
	Revision uint64        `json:"revision"`
	Items    []ActivityDTO `json:"items"`
}
type liveResource struct {
	revision    uint64
	frames      []db.Activity
	subscribers map[chan struct{}]bool
	touched     time.Time
}
type liveHub struct {
	mu        sync.Mutex
	resources map[string]*liveResource
}

func (s *Server) live() *liveHub {
	s.liveOnce.Do(func() { s.liveUI = &liveHub{resources: make(map[string]*liveResource)} })
	return s.liveUI
}
func (h *liveHub) resource(key string) *liveResource {
	r := h.resources[key]
	if r == nil {
		r = &liveResource{subscribers: make(map[chan struct{}]bool)}
		h.resources[key] = r
	}
	return r
}
func (h *liveHub) publish(key string, a db.Activity) {
	if a.StreamID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.resource(key)
	found := false
	for i := range r.frames {
		if r.frames[i].StreamID == a.StreamID {
			r.frames[i] = a
			found = true
			break
		}
	}
	if !found {
		r.frames = append(r.frames, a)
	}
	// Retain completed frames long enough to bridge DB history/poll races, without
	// retaining a complete second transcript. Never evict an active block.
	for len(r.frames) > 24 {
		drop := -1
		for i, f := range r.frames {
			if !f.Streaming {
				drop = i
				break
			}
		}
		if drop < 0 {
			break
		}
		r.frames = append(r.frames[:drop], r.frames[drop+1:]...)
	}
	r.revision++
	r.touched = time.Now()
	for ch := range r.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	// Idle resources expire lazily; active subscriptions and active blocks survive.
	for k, v := range h.resources {
		if len(v.subscribers) == 0 && time.Since(v.touched) > 10*time.Minute {
			delete(h.resources, k)
		}
	}
}
func (h *liveHub) snapshot(key string) liveSnapshot {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.resource(key)
	return liveSnapshot{Revision: r.revision, Items: activityDTOs(append([]db.Activity(nil), r.frames...))}
}
func (h *liveHub) subscribe(key string) (chan struct{}, func()) {
	h.mu.Lock()
	r := h.resource(key)
	ch := make(chan struct{}, 1)
	r.subscribers[ch] = true
	r.touched = time.Now()
	h.mu.Unlock()
	return ch, func() { h.mu.Lock(); delete(r.subscribers, ch); r.touched = time.Now(); h.mu.Unlock() }
}
func (s *Server) liveStream(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, 400, "无效会话 ID")
		return
	}
	scope := r.URL.Query().Get("scope")
	key := scope + ":" + strconv.FormatInt(id, 10)
	switch scope {
	case "conversation":
		pg := s.pg(w)
		if pg == nil {
			return
		}
		c, e := pg.GetConversation(id)
		if e != nil {
			writeErr(w, 500, e.Error())
			return
		}
		if c == nil {
			writeErr(w, 404, "会话不存在")
			return
		}
	case "task":
		if _, ok := s.m.Task(strconv.FormatInt(id, 10)); !ok {
			writeErr(w, 404, "任务不存在")
			return
		}
	default:
		writeErr(w, 400, "无效会话类型")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, 500, "stream unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	hub := s.live()
	changed, cancel := hub.subscribe(key)
	defer cancel()
	send := func() error {
		snapshot := hub.snapshot(key)
		data, e := json.Marshal(snapshot)
		if e != nil {
			return e
		}
		_, e = fmt.Fprintf(w, "id: %d\ndata: %s\n\n", snapshot.Revision, data)
		flusher.Flush()
		return e
	}
	if send() != nil {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-changed:
			if send() != nil {
				return
			}
		case <-heartbeat.C:
			if _, e := fmt.Fprint(w, ": keepalive\n\n"); e != nil {
				return
			}
			flusher.Flush()
		}
	}
}
