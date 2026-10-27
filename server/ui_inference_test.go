package server

import (
	"context"
	"encoding/json"
	"github.com/Autumn-27/norma/llm"
	"github.com/Autumn-27/shrike/db"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestUIInferenceModelSelectionIsRealAndScoped(t *testing.T) {
	m, e := NewManager(t.TempDir(), "")
	if e != nil {
		t.Fatal(e)
	}
	defer m.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	dir := t.TempDir()
	s := New(ctx, m, dir, dir, dir)
	wire := make(chan map[string]any, 16)
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		wire <- body
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"id":"fixture","choices":[{"message":{"role":"assistant","content":"verified"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer fake.Close()
	handler := s.Handler()
	token, tokenErr := signJWT(s.jwtKey)
	if tokenErr != nil {
		t.Fatal(tokenErr)
	}

	p1, e := m.pg.SaveProfile(&db.LLMProfile{Name: "UI infer DeepSeek", Format: "openai", Model: "deepseek-flash", APIKey: "fixture", BaseURL: fake.URL, ReasoningEffort: "low"})
	if e != nil {
		t.Fatal(e)
	}
	defer m.pg.DeleteProfile(p1)
	p2, e := m.pg.SaveProfile(&db.LLMProfile{Name: "UI infer bound", Format: "openai", Model: "deepseek-v4-pro", APIKey: "fixture", BaseURL: fake.URL})
	if e != nil {
		t.Fatal(e)
	}
	defer m.pg.DeleteProfile(p2)
	old, _ := m.pg.GetAgentByKey("mainagent")
	_, e = m.pg.Exec(`UPDATE agents SET llm_profile_id=$1 WHERE key='mainagent'`, p2)
	if e != nil {
		t.Fatal(e)
	}
	defer m.pg.Exec(`UPDATE agents SET llm_profile_id=$1 WHERE key='mainagent'`, old.LLMProfileID)
	c, e := m.pg.CreateConversation("mainagent", "UI model fixture", nil)
	if e != nil {
		t.Fatal(e)
	}
	defer m.pg.DeleteConversation(c.ID)
	put := func(scope string, id int64, settings db.UIInference, setModel bool) int {
		body, _ := json.Marshal(map[string]any{"settings": settings, "set_model": setModel})
		r := httptest.NewRequest("PUT", "/api/ui/inference?scope="+scope+"&id="+strconv.FormatInt(id, 10), strings.NewReader(string(body)))
		w := httptest.NewRecorder()
		r.Header.Set("Authorization", "Bearer "+token)
		handler.ServeHTTP(w, r)
		if w.Code >= 500 {
			t.Fatal(w.Code, w.Body.String())
		}
		return w.Code
	}
	cfg := db.UIInference{ProfileID: &p1, ExplicitModel: true, ThinkingType: "enabled", ReasoningEffort: "max"}
	if code := put("conversation", c.ID, cfg, true); code != 200 {
		t.Fatal(code)
	}
	fresh, _ := m.pg.GetConversation(c.ID)
	if s.resolveChatAgent(fresh) != s.chatAgentForProfile(p1) {
		t.Fatal("UI selection did not override the older agent binding")
	}
	defaultProfile, err := s.defaultInferenceProfile("conversation", c.ID)
	if err != nil || defaultProfile == nil || defaultProfile.ID != p2 {
		t.Fatal("default preview used the explicit pin", defaultProfile, err)
	}
	saved, _ := m.pg.ProfileByID(p1)
	if saved.ReasoningEffort != "low" {
		t.Fatal("shared profile was mutated")
	}

	request := httptest.NewRequest("POST", "/api/conversations/"+strconv.FormatInt(c.ID, 10)+"/messages", strings.NewReader(`{"message":"UI_INFERENCE_FIXTURE"}`))
	request.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, request)
	if rec.Code != 202 {
		t.Fatal("chat send", rec.Code, rec.Body.String())
	}
	select {
	case body := <-wire:
		if body["model"] != "deepseek-flash" || body["reasoning_effort"] != "max" {
			t.Fatal("conversation selection did not reach wire", body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("conversation never called selected provider")
	}
	for i := 0; i < 100; i++ {
		s.chatMu.Lock()
		busy := s.chatBusy[s.convBusyKey(c.ID)]
		s.chatMu.Unlock()
		if !busy {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cfg.ReasoningEffort = "medium"
	if put("conversation", c.ID, cfg, false) != 400 {
		t.Fatal("unsupported DeepSeek medium accepted")
	}
	cfg.ReasoningEffort = "max"
	task, e := m.CreateTaskWithOptions("UI infer task fixture", "test", db.TaskCreateOptions{})
	if e != nil {
		t.Fatal(e)
	}
	defer m.pg.DeleteTask(mustUIInferenceTaskID(t, task.ID))
	if put("task", mustUIInferenceTaskID(t, task.ID), cfg, true) != 200 {
		t.Fatal("task selection failed")
	}
	for _, role := range []string{"mainagent", "planner", "worker"} {
		runtime := &taskLLMRuntime{s: s, taskID: task.ID, agentKey: role}
		selected, e := runtime.current()
		if e != nil || selected.profileID != p1 {
			t.Fatal(role, selected.profileID, e)
		}
		if _, _, _, err := runtime.Complete(context.Background(), llm.CompletionRequest{}); err != nil {
			t.Fatal("task scoped request", err)
		}
		if body := <-wire; body["model"] != "deepseek-flash" || body["reasoning_effort"] != "max" {
			t.Fatal("task UI did not reach wire", role, body)
		}
		resolved, e := s.resolveTaskRoleLLM(task, role)
		if e != nil || resolved.ProfileID == nil || *resolved.ProfileID != p1 {
			t.Fatal("UI effective model differs from router", role, e)
		}
	}
	state := task.llmStateSnapshot()
	if _, err := m.pg.MarkTaskLLMProfileQuotaExhaustedAtRevision(mustUIInferenceTaskID(t, task.ID), p1, state.ChainRevision, "fixture quota"); err != nil {
		t.Fatal(err)
	}
	pt, err := m.pg.GetTask(mustUIInferenceTaskID(t, task.ID))
	if err != nil {
		t.Fatal(err)
	}
	s.syncTaskLLMState(pt)
	scoped, err := m.pg.UIInference("task", mustUIInferenceTaskID(t, task.ID))
	if err != nil {
		t.Fatal(err)
	}
	if effective, err := s.inferenceProfile("task", mustUIInferenceTaskID(t, task.ID), scoped); err != nil || effective != nil {
		t.Fatal("exhausted chain was falsely displayed as an active default", effective, err)
	}
	w := httptest.NewRecorder()
	s.uiGetInference(w, httptest.NewRequest("GET", "/api/ui/inference?scope=conversation&id="+strconv.FormatInt(c.ID, 10), nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"max"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	if put("conversation", c.ID, db.UIInference{}, true) != 200 {
		t.Fatal("reset failed")
	}
	fresh, _ = m.pg.GetConversation(c.ID)
	if s.resolveChatAgent(fresh) != s.chatAgentForProfile(p2) {
		t.Fatal("reset did not restore agent model")
	}
	if fresh.LLMProfileID != nil {
		t.Fatal("follow-default kept a legacy pin")
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/ui/inference?scope=task&id="+task.ID, nil))
	if w.Code != 401 {
		t.Fatal("missing auth accepted", w.Code)
	}
	t.Log("CONVERSATION_SELECTION=real TASK_ALL_ROLES=real PROFILE=unchanged UNSUPPORTED_EFFORT=400 AUTH=401 WIRE_TASK_AND_CHAT=max")
}
func mustUIInferenceTaskID(t *testing.T, id string) int64 {
	t.Helper()
	n, e := strconv.ParseInt(id, 10, 64)
	if e != nil {
		t.Fatal(e)
	}
	return n
}
