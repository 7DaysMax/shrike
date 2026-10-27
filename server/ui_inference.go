package server

import (
	"context"
	"fmt"
	"github.com/Autumn-27/shrike/config"
	"github.com/Autumn-27/shrike/db"
	"github.com/Autumn-27/shrike/llmrec"
	"net/http"
	"strconv"
)

func inferenceLevels(p *db.LLMProfile) []string {
	if p == nil {
		return nil
	}
	return config.InferenceEfforts(p.Model, p.ReasoningEffort)
}
func validateInference(v db.UIInference, p *db.LLMProfile) error {
	switch v.ThinkingType {
	case "", "enabled", "disabled", "adaptive":
	default:
		return fmt.Errorf("未知思考模式")
	}
	if v.ProfileID != nil && *v.ProfileID <= 0 {
		return fmt.Errorf("模型配置 ID 无效")
	}
	if v.ReasoningEffort != "" {
		for _, level := range inferenceLevels(p) {
			if level == v.ReasoningEffort {
				return nil
			}
		}
		return fmt.Errorf("当前模型未声明思考档位 %q", v.ReasoningEffort)
	}
	return nil
}
func (s *Server) uiInferenceOwner(w http.ResponseWriter, r *http.Request) (string, int64, bool) {
	scope := r.URL.Query().Get("scope")
	id, e := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if e != nil || id <= 0 || (scope != "conversation" && scope != "task") {
		writeErr(w, 400, "scope 或 id 无效")
		return "", 0, false
	}
	if s.m == nil || s.m.pg == nil {
		writeErr(w, 503, "数据库尚未就绪")
		return "", 0, false
	}
	if scope == "conversation" {
		c, e := s.m.pg.GetConversation(id)
		if e != nil {
			writeErr(w, 500, e.Error())
			return "", 0, false
		}
		if c == nil {
			writeErr(w, 404, "会话不存在")
			return "", 0, false
		}
		if c.TaskID != nil {
			scope = "task"
			id = *c.TaskID
		}
	}
	if scope == "task" {
		if _, ok := s.m.Task(strconv.FormatInt(id, 10)); !ok {
			writeErr(w, 404, "任务不存在")
			return "", 0, false
		}
	}
	return scope, id, true
}
func (s *Server) inferenceProfile(scope string, id int64, v db.UIInference) (*db.LLMProfile, error) {
	var selected *int64
	if scope == "task" {
		t, _ := s.m.Task(strconv.FormatInt(id, 10))
		if t == nil {
			return nil, fmt.Errorf("任务不存在")
		}
		resolved, e := s.resolveTaskRoleLLM(t, "mainagent")
		if e != nil {
			return nil, e
		}
		if !resolved.Available {
			return nil, nil
		}
		selected = resolved.ProfileID
	} else if v.ExplicitModel {
		selected = v.ProfileID
	} else {
		c, e := s.m.pg.GetConversation(id)
		if e != nil {
			return nil, e
		}
		if c != nil {
			selected = s.effectiveProfileForAgent(c.AgentKey, c.LLMProfileID)
		}
	}
	if selected != nil {
		return s.m.pg.ProfileByID(*selected)
	}
	return s.m.pg.ActiveProfile()
}

// The default menu entry describes the route AFTER an explicit pin is cleared,
// not the model that happens to be selected now.
func (s *Server) defaultInferenceProfile(scope string, id int64) (*db.LLMProfile, error) {
	key := "mainagent"
	if scope == "conversation" {
		c, err := s.m.pg.GetConversation(id)
		if err != nil {
			return nil, err
		}
		if c != nil {
			key = c.AgentKey
		}
	}
	a, err := s.m.pg.GetAgentByKey(key)
	if err != nil {
		return nil, err
	}
	if a != nil && a.LLMProfileID != nil {
		if _, _, ok := s.providerForProfile(*a.LLMProfileID); ok {
			return s.m.pg.ProfileByID(*a.LLMProfileID)
		}
	}
	return s.m.pg.ActiveProfile()
}
func (s *Server) uiGetInference(w http.ResponseWriter, r *http.Request) {
	scope, id, ok := s.uiInferenceOwner(w, r)
	if !ok {
		return
	}
	s.writeInference(w, scope, id)
}
func (s *Server) writeInference(w http.ResponseWriter, scope string, id int64) {
	value, e := s.m.pg.UIInference(scope, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	profile, e := s.inferenceProfile(scope, id, value)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	defaultProfile, e := s.defaultInferenceProfile(scope, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	profiles, e := s.m.pg.ListProfiles()
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	levels := map[string][]string{}
	for _, p := range profiles {
		levels[strconv.FormatInt(p.ID, 10)] = inferenceLevels(p)
	}
	if value.ReasoningEffort != "" && !config.HasInferenceEffort(inferenceLevels(profile), value.ReasoningEffort) {
		value.ReasoningEffort = ""
	}
	var defaultDTO any
	if defaultProfile != nil {
		defaultDTO = llmProfileDTO(defaultProfile)
	}
	var effective any
	if profile != nil {
		effective = llmProfileDTO(profile)
	}
	writeJSON(w, 200, map[string]any{"scope": scope, "id": id, "settings": value, "effective": effective, "default_profile": defaultDTO, "levels": levels, "profiles": llmProfileDTOs(profiles)})
}
func (s *Server) uiPutInference(w http.ResponseWriter, r *http.Request) {
	scope, id, ok := s.uiInferenceOwner(w, r)
	if !ok {
		return
	}
	var req struct {
		Settings db.UIInference `json:"settings"`
		SetModel bool           `json:"set_model"`
	}
	if !decodeConversationRequest(w, r, &req) {
		return
	}
	old, e := s.m.pg.UIInference(scope, id)
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	next := req.Settings
	if !req.SetModel {
		next.ProfileID = old.ProfileID
		next.ExplicitModel = old.ExplicitModel
	} else {
		next.ExplicitModel = next.ProfileID != nil
	}
	profile, e := s.inferenceProfile(scope, id, old)
	if req.SetModel && next.ProfileID == nil {
		profile, e = s.defaultInferenceProfile(scope, id)
	}
	if req.SetModel && next.ProfileID != nil {
		profile, e = s.m.pg.ProfileByID(*next.ProfileID)
		if e == nil {
			if _, valid := s.loadProfileConfig(*next.ProfileID); !valid {
				writeErr(w, 400, "模型配置不可用")
				return
			}
		}
	}
	if e != nil {
		writeErr(w, 500, e.Error())
		return
	}
	if e = validateInference(next, profile); e != nil {
		writeErr(w, 400, e.Error())
		return
	}
	if scope == "task" && req.SetModel {
		t, _ := s.m.Task(strconv.FormatInt(id, 10))
		before := t.llmStateSnapshot()
		ids := []int64{}
		active := int64(0)
		if next.ProfileID != nil {
			active = *next.ProfileID
			ids = append(ids, active)
			for _, v := range before.ProfileIDs {
				if v != active {
					ids = append(ids, v)
				}
			}
		}
		if _, e = s.m.ReplaceTaskLLMProfiles(t.ID, ids, active, &next); e != nil {
			writeErr(w, 400, e.Error())
			return
		}
		after := t.llmStateSnapshot()
		if !sameOptionalID(before.ActiveID, after.ActiveID) {
			s.emitManualTaskLLMSwitch(t, before.ActiveID, after.ActiveID)
		}
		t.Notify()
		go s.reconcileConcurrency()
	} else {
		if scope == "conversation" && req.SetModel {
			e = s.m.pg.SaveConversationInference(id, next)
		} else {
			e = s.m.pg.SaveUIInference(scope, id, next)
		}
		if e != nil {
			writeErr(w, 500, e.Error())
			return
		}
	}
	s.writeInference(w, scope, id)
}
func (s *Server) taskPrefersUIModel(id string) bool {
	if s.m == nil || s.m.pg == nil {
		return false
	}
	n, _ := strconv.ParseInt(id, 10, 64)
	v, e := s.m.pg.UIInference("task", n)
	return e == nil && v.ExplicitModel
}
func (r *taskLLMRuntime) inferenceContext(ctx context.Context) (context.Context, error) {
	id, e := strconv.ParseInt(r.taskID, 10, 64)
	if e != nil {
		return ctx, e
	}
	v, e := r.s.m.pg.UIInference("task", id)
	if e != nil {
		return ctx, e
	}
	return llmrec.WithInference(ctx, llmrec.InferenceOptions{ThinkingType: v.ThinkingType, ReasoningEffort: v.ReasoningEffort}), nil
}
