package server

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const uiTerminalBuffer = 1 << 20

type uiTerminalManager struct {
	mu       sync.Mutex
	once     sync.Once
	sessions map[string]*uiTerminal
}
type uiTerminal struct {
	mu       sync.Mutex
	inputMu  sync.Mutex
	id       string
	title    string
	created  time.Time
	running  bool
	exitCode int
	stream   io.ReadWriteCloser
	resize   func(uint16, uint16) error
	stop     func()
	output   []byte
	cursor   int64
}
type uiTerminalInfo struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Created      string `json:"created_at"`
	Running      bool   `json:"running"`
	ExitCode     int    `json:"exit_code"`
	Output       string `json:"output,omitempty"`
	OutputBase64 string `json:"output_base64,omitempty"`
	Cursor       int64  `json:"cursor"`
	Reset        bool   `json:"reset"`
}

func (t *uiTerminal) appendOutput(data []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.output = append(t.output, data...)
	t.cursor += int64(len(data))
	if len(t.output) > uiTerminalBuffer {
		t.output = append([]byte(nil), t.output[len(t.output)-uiTerminalBuffer:]...)
	}
}
func (t *uiTerminal) snapshot(cursor int64) uiTerminalInfo {
	t.mu.Lock()
	defer t.mu.Unlock()
	start := t.cursor - int64(len(t.output))
	reset := cursor < start || cursor > t.cursor
	if reset {
		cursor = start
	}
	if cursor < 0 {
		cursor = 0
	}
	return uiTerminalInfo{ID: t.id, Title: t.title, Created: t.created.UTC().Format(time.RFC3339), Running: t.running, ExitCode: t.exitCode, Output: string(t.output[cursor-start:]), OutputBase64: base64.StdEncoding.EncodeToString(t.output[cursor-start:]), Cursor: t.cursor, Reset: reset}
}
func validUITerminalID(id string) bool {
	if len(id) < 1 || len(id) > 100 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune(":-_", c)) {
			return false
		}
	}
	return true
}
func (m *uiTerminalManager) get(id string) *uiTerminal {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}
func (m *uiTerminalManager) create(id, dir string, cols, rows uint16) (*uiTerminal, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions == nil {
		m.sessions = map[string]*uiTerminal{}
	}
	if old := m.sessions[id]; old != nil {
		return old, nil
	}
	if len(m.sessions) >= 8 {
		return nil, fmt.Errorf("终端数量已达 8 个，请先关闭一个终端")
	}
	stream, resize, stop, wait, err := startUITerminal(dir, cols, rows)
	if err != nil {
		return nil, err
	}
	t := &uiTerminal{id: id, title: "终端", created: time.Now(), running: true, stream: stream, resize: resize, stop: stop}
	m.sessions[id] = t
	go func() {
		buf := make([]byte, 8192)
		for {
			n, e := stream.Read(buf)
			if n > 0 {
				t.appendOutput(buf[:n])
			}
			if e != nil {
				break
			}
		}
		code := wait()
		_ = stream.Close()
		t.mu.Lock()
		t.running = false
		t.exitCode = code
		t.mu.Unlock()
	}()
	return t, nil
}
func (m *uiTerminalManager) remove(id string) bool {
	m.mu.Lock()
	t := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if t == nil {
		return false
	}
	t.stop()
	return true
}
func (m *uiTerminalManager) closeAll() {
	m.mu.Lock()
	sessions := m.sessions
	m.sessions = map[string]*uiTerminal{}
	m.mu.Unlock()
	for _, t := range sessions {
		t.stop()
	}
}
func (s *Server) registerUIRoutes(mux *http.ServeMux) {
	s.uiTerminals.once.Do(func() {
		if s.ctx != nil {
			go func(ctx context.Context) { <-ctx.Done(); s.uiTerminals.closeAll() }(s.ctx)
		}
	})
	mux.HandleFunc("GET /api/ui/terminals", s.uiListTerminals)
	mux.HandleFunc("POST /api/ui/terminals", s.uiCreateTerminal)
	mux.HandleFunc("GET /api/ui/terminals/{id}", s.uiReadTerminal)
	mux.HandleFunc("POST /api/ui/terminals/{id}/input", s.uiWriteTerminal)
	mux.HandleFunc("POST /api/ui/terminals/{id}/resize", s.uiResizeTerminal)
	mux.HandleFunc("DELETE /api/ui/terminals/{id}", s.uiCloseTerminal)
}
func (s *Server) uiListTerminals(w http.ResponseWriter, r *http.Request) {
	out := []uiTerminalInfo{}
	s.uiTerminals.mu.Lock()
	for _, t := range s.uiTerminals.sessions {
		v := t.snapshot(0)
		v.Output = ""
		v.OutputBase64 = ""
		out = append(out, v)
	}
	s.uiTerminals.mu.Unlock()
	writeJSON(w, 200, map[string]any{"terminals": out})
}
func (s *Server) uiCreateTerminal(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   string `json:"id"`
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := decode(r, &req); err != nil || !validUITerminalID(req.ID) {
		writeErr(w, 400, "终端参数无效")
		return
	}
	if req.Cols == 0 {
		req.Cols = 100
	}
	if req.Rows == 0 {
		req.Rows = 30
	}
	if req.Cols > 500 || req.Rows > 300 {
		writeErr(w, 400, "终端尺寸无效")
		return
	}
	t, err := s.uiTerminals.create(req.ID, s.m.dir, req.Cols, req.Rows)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	v := t.snapshot(0)
	v.Output = ""
		v.OutputBase64 = ""
	writeJSON(w, 200, v)
}
func (s *Server) uiReadTerminal(w http.ResponseWriter, r *http.Request) {
	t := s.uiTerminals.get(r.PathValue("id"))
	if t == nil {
		writeErr(w, 404, "终端已关闭")
		return
	}
	cursor, err := strconv.ParseInt(r.URL.Query().Get("cursor"), 10, 64)
	if err != nil || cursor < 0 {
		cursor = 0
	}
	writeJSON(w, 200, t.snapshot(cursor))
}
func (s *Server) uiWriteTerminal(w http.ResponseWriter, r *http.Request) {
	t := s.uiTerminals.get(r.PathValue("id"))
	if t == nil {
		writeErr(w, 404, "终端已关闭")
		return
	}
	var req struct {
		Input string `json:"input"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 65536)
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "输入格式无效")
		return
	}
	t.inputMu.Lock()
	_, err := io.WriteString(t.stream, req.Input)
	t.inputMu.Unlock()
	if err != nil {
		writeErr(w, 409, "终端进程已退出")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) uiResizeTerminal(w http.ResponseWriter, r *http.Request) {
	t := s.uiTerminals.get(r.PathValue("id"))
	if t == nil {
		writeErr(w, 404, "终端已关闭")
		return
	}
	var req struct {
		Cols uint16 `json:"cols"`
		Rows uint16 `json:"rows"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if err := decode(r, &req); err != nil || req.Cols < 2 || req.Rows < 2 || req.Cols > 500 || req.Rows > 300 {
		writeErr(w, 400, "终端尺寸无效")
		return
	}
	if err := t.resize(req.Cols, req.Rows); err != nil {
		writeErr(w, 409, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) uiCloseTerminal(w http.ResponseWriter, r *http.Request) {
	s.uiTerminals.remove(r.PathValue("id"))
	writeJSON(w, 200, map[string]bool{"ok": true})
}
