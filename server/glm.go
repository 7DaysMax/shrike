package server

// GLM(Z.AI / 智谱 BigModel)账号登录 + 模型列表。协议复刻 ZCode(zai-org/ZCode,
// Z.ai 官方开源 coding agent harness)的 CLI OAuth 轮询流程:
//
//	POST https://zcode.z.ai/api/v1/oauth/cli/init    {"provider":"zai"|"bigmodel"}
//	                                                 + Authorization: Bearer <poll_token>
//	  → data:{authorize_url, flow_id, expires_at, poll_interval_sec}
//	浏览器打开 authorize_url(chat.z.ai / bigmodel.cn 官方授权页,页内官网账号登录)
//	  → 授权结果由 ZCode 官方云端接收,无本地回调(这正是比 DeepSeek 流程省事的地方)
//	GET https://zcode.z.ai/api/v1/oauth/cli/poll/<flow_id> + Bearer <poll_token>
//	  → data:{status: pending|ready|failed};ready 携带 token(即 zcodejwttoken)
//
// JWT 直接当 API Key 用:GLM 套餐推理走 Anthropic Messages 兼容端点,x-api-key 与
// Bearer 均被接受(ZCode 官方注释),SHRIKE 的 anthropic 格式 profile 把 JWT 存进
// api_key 即可,无需特殊鉴权注入。token 有配套 refreshToken,本实现按 DeepSeek 同
// 款策略处理:失效时提示重新登录。
//
// 模型/余额: GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=…
//   Authorization: Bearer <jwt> + X-Device-Mid(必填,缺失 → 400 {"code":3001})
//   → data.plans[](活跃套餐) + data.balances[](额度桶,capabilities=模型 ID 列表),
//   模型列表取各桶 capabilities 的并集。

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/Autumn-27/shrike/db"
)

const (
	// ZCode 官方后端(登录中转 + Start Plan 套餐网关)。
	glmZcodeAPIBase = "https://zcode.z.ai/api/v1"

	// 各套餐的 Anthropic Messages 推理端点(ZCode builtin provider 配置原样)。
	glmZaiCodingAnthropic      = "https://api.z.ai/api/anthropic"
	glmBigModelCodingAnthropic = "https://open.bigmodel.cn/api/anthropic"
	glmStartPlanAnthropic      = glmZcodeAPIBase + "/zcode-plan/anthropic"

	// Z.AI 业务 token 交换:poll 拿到的 zai.access_token 是 OAuth token,推理接口
	// 只认用它换出来的业务 JWT(ZCode: "Z.AI 业务接口只认 /api/auth/z/login 返回
	// 的平台 JWT")。BigModel 无此二次交换,poll 直接返回业务 token。
	glmZaiBusinessLoginURL = "https://api.z.ai/api/auth/z/login"

	// 业务 API(组织/项目/API Key/PAT 管理)来源,与 ZCode 的 ZAI_API_HOST /
	// bigmodel origin 常量一致。
	glmZaiBizAPIBase      = "https://api.z.ai"
	glmBigModelBizAPIBase = "https://open.bigmodel.cn"

	// balance 接口按 app_version 观察客户端版本身份;取当前桌面版版本线。
	glmAppVersion = "3.16.2"

	glmTokenKeyFmt  = "glm.%s.token"  // glm.<provider>.token(ZCode JWT,balance 用)
	glmAccessKeyFmt = "glm.%s.access" // glm.<provider>.access(业务 JWT,推理 api_key 用)
	glmOAuthKeyFmt  = "glm.%s.oauth"  // glm.<provider>.oauth(OAuth token,换业务 JWT 的原料)
	glmUserKeyFmt   = "glm.%s.user"   // glm.<provider>.user(账号信息 JSON)
	glmDeviceKey    = "glm.device_mid"

	glmFlowTTL = 10 * time.Minute
)

var glmProviders = map[string]bool{"zai": true, "bigmodel": true}

// glmFlow 是一次进行中的登录尝试。pollToken 只放内存与 Authorization 头,
// 不落日志。
type glmFlow struct {
	provider   string
	pollToken  string
	flowID     string
	expiresAt  time.Time
	interval   time.Duration
	authorize  string
	createdAt  time.Time
}

// glmStartFlow 记录一次新的登录尝试(覆盖旧的;旧 flow 随即失效,与 ZCode 的
// "后一次请求拥有 flow" 语义一致)。
func (s *Server) glmStartFlow(f *glmFlow) {
	s.glmMu.Lock()
	s.glmFlow = f
	s.glmNextPoll = time.Time{}
	s.glmMu.Unlock()
}

// glmTakeFlow 取走当前 flow(匹配 flowId 且未过期),取走即失效。
func (s *Server) glmTakeFlow(flowID string) *glmFlow {
	s.glmMu.Lock()
	defer s.glmMu.Unlock()
	f := s.glmFlow
	s.glmFlow = nil
	if f == nil || f.flowID != flowID || time.Since(f.createdAt) > glmFlowTTL {
		return nil
	}
	return f
}

// glmCurrentFlow 只读当前 flow(轮询用)。
func (s *Server) glmCurrentFlow() *glmFlow {
	s.glmMu.Lock()
	defer s.glmMu.Unlock()
	return s.glmFlow
}

// glmThrottlePoll 距上次后端 poll 不足 interval 时返回 false(本次直接用缓存,
// 不打后端)。
func (s *Server) glmThrottlePoll(interval time.Duration) bool {
	s.glmMu.Lock()
	defer s.glmMu.Unlock()
	now := time.Now()
	if !s.glmNextPoll.IsZero() && now.Before(s.glmNextPoll) {
		return false
	}
	s.glmNextPoll = now.Add(interval)
	return true
}

// glmToken 读指定品牌的账号 token(直接查 settings;量小,不做进程内缓存)。
func (s *Server) glmToken(pg *db.DB, provider string) (string, bool) {
	tok, ok, err := pg.GetSetting(fmt.Sprintf(glmTokenKeyFmt, provider))
	if err != nil || !ok || tok == "" {
		return "", false
	}
	return tok, true
}

// ---------- 平台请求 ----------

// glmCall 调 ZCode 后端 JSON 接口并宽松解析响应壳 {code, msg, data}
// (code!=0 视为业务错误;无壳时原样返回)。deviceMid 非空时随请求发送
// X-Device-Mid(balance 接口必填,缺失 → 400 code=3001)。
func glmCall(ctx context.Context, method, url string, body any, pollToken, jwt, deviceMid string) (json.RawMessage, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rd)
	if err != nil {
		return nil, err
	}
	if pollToken != "" {
		req.Header.Set("Authorization", "Bearer "+pollToken)
	}
	if jwt != "" {
		req.Header.Set("Authorization", "Bearer "+jwt)
	}
	if deviceMid != "" {
		req.Header.Set("X-Device-Mid", deviceMid)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ZCode 后端返回 HTTP %d: %s", resp.StatusCode, dsClip(string(raw)))
	}
	var shell struct {
		Code    *int            `json:"code"`
		Msg     string          `json:"msg"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &shell); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if shell.Code != nil && *shell.Code != 0 {
		return nil, fmt.Errorf("业务错误 %d: %s", *shell.Code, firstNonEmpty(shell.Msg, shell.Message, "未知错误"))
	}
	if len(shell.Data) > 0 {
		return shell.Data, nil
	}
	return json.RawMessage(raw), nil
}

// jsonFindStringSlice 深度优先收集指定 key 下的字符串数组(模型 capabilities)。
func jsonFindStringSlice(v any, key string) []string {
	var out []string
	var walk func(x any)
	walk = func(x any) {
		switch t := x.(type) {
		case map[string]any:
			for k, val := range t {
				if strings.EqualFold(k, key) {
					if arr, ok := val.([]any); ok {
						for _, item := range arr {
							if s, ok := item.(string); ok && s != "" {
								out = append(out, s)
							}
						}
					}
				}
				walk(val)
			}
		case []any:
			for _, item := range t {
				walk(item)
			}
		}
	}
	walk(v)
	return out
}

// ---------- handlers ----------

// POST /api/llm/glm/login {provider} — 发起登录,返回官方授权页地址。
func (s *Server) glmLogin(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var req struct {
		Provider string `json:"provider"` // "zai" | "bigmodel"
	}
	if err := decode(r, &req); err != nil || !glmProviders[req.Provider] {
		writeErr(w, 400, "provider 必须是 zai 或 bigmodel")
		return
	}
	pollToken := glmRandomToken()
	payload, err := glmCall(r.Context(), http.MethodPost, glmZcodeAPIBase+"/oauth/cli/init",
		map[string]any{"provider": req.Provider}, pollToken, "", "")
	if err != nil {
		log.Printf("[glm] oauth init 失败: %v", err)
		writeErr(w, 502, "ZCode 后端连接失败: "+err.Error())
		return
	}
	var parsed struct {
		AuthorizeURL    string `json:"authorize_url"`
		FlowID          string `json:"flow_id"`
		ExpiresAt       int64  `json:"expires_at"`
		PollIntervalSec int    `json:"poll_interval_sec"`
	}
	_ = json.Unmarshal(payload, &parsed)
	if parsed.AuthorizeURL == "" || parsed.FlowID == "" {
		// 壳可能多包一层,深度兜底提取。
		var m map[string]any
		_ = json.Unmarshal(payload, &m)
		parsed.AuthorizeURL = jsonFindString(m, "authorize_url")
		parsed.FlowID = jsonFindString(m, "flow_id")
	}
	if parsed.AuthorizeURL == "" || parsed.FlowID == "" {
		writeErr(w, 502, "后端未返回授权地址(协议可能有变化,请关注 ZCode 更新)")
		return
	}
	interval := time.Duration(parsed.PollIntervalSec) * time.Second
	if interval < time.Second {
		interval = 2 * time.Second
	}
	expires := time.Now().Add(glmFlowTTL)
	if parsed.ExpiresAt > 0 {
		expires = time.Unix(parsed.ExpiresAt, 0)
	}
	s.glmStartFlow(&glmFlow{
		provider: req.Provider, pollToken: pollToken, flowID: parsed.FlowID,
		expiresAt: expires, interval: interval, authorize: parsed.AuthorizeURL,
		createdAt: time.Now(),
	})
	log.Printf("[glm] %s 登录已发起,等待浏览器授权", req.Provider)
	writeJSON(w, 200, map[string]any{"authorize_url": parsed.AuthorizeURL})
}

// GET /api/llm/glm/status?provider=zai — 登录态。有进行中的 flow 时顺带向后端
// poll 一次(按 poll_interval 节流);ready 即保存凭据并返回 token。
func (s *Server) glmStatus(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	provider := r.URL.Query().Get("provider")
	if !glmProviders[provider] {
		provider = "zai"
	}
	if flow := s.glmCurrentFlow(); flow != nil && flow.provider == provider && time.Now().Before(flow.expiresAt) {
		if s.glmThrottlePoll(flow.interval) {
			s.glmPollBackend(w, r, pg, flow, provider)
			return
		}
		writeJSON(w, 200, map[string]any{"authorized": false, "status": "pending", "provider": provider})
		return
	}
	// 无进行中 flow:报告已存凭据的登录态。token=业务 JWT(推理 api_key 用);
	// zcode_token=ZCode JWT(balance 用,Start Plan 路径的鉴权凭据)。旧版登录只落了
	// zcode JWT、没有业务 token —— 标记 needs_relogin,前端提示重新登录一次。
	if tok, ok := s.glmToken(pg, provider); ok {
		var user map[string]any
		if stored, _, err := pg.GetSetting(fmt.Sprintf(glmUserKeyFmt, provider)); err == nil && stored != "" {
			_ = json.Unmarshal([]byte(stored), &user)
		}
		access, _, _ := pg.GetSetting(fmt.Sprintf(glmAccessKeyFmt, provider))
		out := map[string]any{
			"authorized":    true,
			"provider":      provider,
			"user":          user,
			"token":         access,
			"zcode_token":   tok,
			"needs_relogin": access == "",
		}
		// 套餐余量:官网 billing/balance 同款数据,60s 进程内缓存(前端轮询命中缓存)。
		out["quota"] = s.glmQuota(r.Context(), provider, tok)
		writeJSON(w, 200, out)
		return
	}
	writeJSON(w, 200, map[string]any{"authorized": false, "provider": provider})
}

const glmQuotaTTL = 60 * time.Second

// glmQuota 拉取套餐余量摘要(官网 billing/balance,60s 缓存),按模型聚合剩余额度。
func (s *Server) glmQuota(ctx context.Context, provider, token string) map[string]any {
	s.glmMu.Lock()
	if s.glmQuotaData == nil {
		s.glmQuotaData = map[string]json.RawMessage{}
		s.glmQuotaAts = map[string]time.Time{}
	}
	if raw, ok := s.glmQuotaData[provider]; ok && time.Since(s.glmQuotaAts[provider]) < glmQuotaTTL {
		s.glmMu.Unlock()
		return s.glmQuotaOut(provider, raw)
	}
	s.glmMu.Unlock()

	deviceMid, err := s.glmDeviceMid(s.m.pg)
	payload := map[string]any{}
	if err == nil {
		url := glmZcodeAPIBase + "/zcode-plan/billing/balance?app_version=" + glmAppVersion
		if raw, err := glmCall(ctx, http.MethodGet, url, nil, "", token, deviceMid); err == nil {
			payload["raw"] = json.RawMessage(raw)
			s.glmMu.Lock()
			s.glmQuotaData[provider] = raw
			s.glmQuotaAts[provider] = time.Now()
			s.glmMu.Unlock()
			return s.glmQuotaOut(provider, raw)
		} else {
			payload["error"] = err.Error()
		}
	} else {
		payload["error"] = err.Error()
	}
	return payload
}

// glmQuotaOut 把 balance 原始报文聚合成按模型的余量列表(展示用)。
func (s *Server) glmQuotaOut(provider string, raw json.RawMessage) map[string]any {
	var m struct {
		Plans []struct {
			PlanID string `json:"plan_id"`
			Name   string `json:"name"`
			Status string `json:"status"`
			EndsAt int64  `json:"ends_at"`
		} `json:"plans"`
		Balances []struct {
			ShowName      string  `json:"show_name"`
			PlanID        string  `json:"plan_id"`
			AvailableUnits float64 `json:"available_units"`
			TotalUnits    float64 `json:"total_units"`
			ExpiresAt     int64   `json:"expires_at"`
		} `json:"balances"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return map[string]any{"error": "解析套餐数据失败"}
	}
	buckets := make([]map[string]any, 0, len(m.Balances))
	for _, b := range m.Balances {
		buckets = append(buckets, map[string]any{
			"model":      b.ShowName,
			"plan":       b.PlanID,
			"available":  b.AvailableUnits,
			"total":      b.TotalUnits,
			"expires_at": b.ExpiresAt,
		})
	}
	return map[string]any{"buckets": buckets, "plans": m.Plans}
}

// glmPollBackend 向 ZCode 后端轮询一次 flow 结果,按结果落库/清理并回包。
func (s *Server) glmPollBackend(w http.ResponseWriter, r *http.Request, pg *db.DB, flow *glmFlow, provider string) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	payload, err := glmCall(ctx, http.MethodGet, glmZcodeAPIBase+"/oauth/cli/poll/"+flow.flowID, nil, flow.pollToken, "", "")
	if err != nil {
		// 轮询单次失败不结束 flow(网络抖动常见),回 pending 让前端继续等。
		log.Printf("[glm] poll 失败(继续等待): %v", err)
		writeJSON(w, 200, map[string]any{"authorized": false, "status": "pending", "provider": provider})
		return
	}
	var parsed struct {
		Status   string         `json:"status"`
		Token    string         `json:"token"`
		User     map[string]any `json:"user"`
		Zai      map[string]any `json:"zai"`
		BigModel map[string]any `json:"bigmodel"`
	}
	_ = json.Unmarshal(payload, &parsed)
	switch parsed.Status {
	case "ready":
		if parsed.Token == "" {
			var m map[string]any
			_ = json.Unmarshal(payload, &m)
			parsed.Token = jsonFindString(m, "token", "access_token")
		}
		if parsed.Token == "" {
			writeJSON(w, 200, map[string]any{"authorized": false, "status": "failed", "provider": provider, "error": "ready 响应缺少 token"})
			return
		}
		// 按品牌取业务凭据:zai 的 ready.zai.access_token 是 OAuth token,还要经
		// /api/auth/z/login 换成业务 JWT 才能调推理;bigmodel 的 ready.bigmodel.
		// access_token 直接就是业务 token(ZCode: polling 无需二次兑换)。
		var oauthToken string
		switch provider {
		case "zai":
			oauthToken = jsonFindString(parsed.Zai, "access_token")
		case "bigmodel":
			oauthToken = jsonFindString(parsed.BigModel, "access_token", "accessToken")
		}
		businessToken := oauthToken
		if provider == "zai" && oauthToken != "" {
			bt, _, err := glmZaiBusinessToken(r.Context(), oauthToken)
			if err != nil {
				// 兑换失败不阻塞登录:落 OAuth token 兜底,推理 401 时提示重新登录。
				log.Printf("[glm] Z.AI 业务 token 兑换失败(将以 OAuth token 兜底): %v", err)
			} else {
				businessToken = bt
			}
		}
		if err := pg.SetSetting(fmt.Sprintf(glmTokenKeyFmt, provider), parsed.Token); err != nil {
			writeErr(w, 500, "保存 token 失败: "+err.Error())
			return
		}
		if businessToken != "" {
			_ = pg.SetSetting(fmt.Sprintf(glmAccessKeyFmt, provider), businessToken)
		}
		if oauthToken != "" {
			_ = pg.SetSetting(fmt.Sprintf(glmOAuthKeyFmt, provider), oauthToken)
		}
		userJSON, _ := json.Marshal(parsed.User)
		_ = pg.SetSetting(fmt.Sprintf(glmUserKeyFmt, provider), string(userJSON))
		writeJSON(w, 200, map[string]any{
			"authorized": true, "status": "ready", "provider": provider,
			"user": parsed.User, "token": businessToken, "zcode_token": parsed.Token,
		})
	case "failed":
		writeJSON(w, 200, map[string]any{"authorized": false, "status": "failed", "provider": provider, "error": "授权被拒绝或已过期"})
	default: // pending / 未知
		writeJSON(w, 200, map[string]any{"authorized": false, "status": "pending", "provider": provider})
	}
}

// glmZaiBusinessToken 用 Z.AI OAuth token 换推理用的业务 JWT。
// POST https://api.z.ai/api/auth/z/login {"token": …} → {code:0, data:{access_token, expires_in}}。
// ZCode 原话:"Z.AI 业务接口只认 /api/auth/z/login 返回的平台 JWT"。
func glmZaiBusinessToken(ctx context.Context, oauthToken string) (string, int64, error) {
	// 注意不能用 glmCall:该端点的成功码是 200(非 0),响应壳 {code, msg, success, data}。
	var rd io.Reader
	b, _ := json.Marshal(map[string]any{"token": oauthToken})
	rd = bytes.NewReader(b)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, glmZaiBusinessLoginURL, rd)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var shell struct {
		Code    *int   `json:"code"`
		Msg     string `json:"msg"`
		Success *bool  `json:"success"`
		Data    struct {
			AccessToken  string `json:"access_token"`
			AccessToken2 string `json:"accessToken"`
			ExpiresIn    int64  `json:"expires_in"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &shell); err != nil {
		return "", 0, fmt.Errorf("解析业务 token 响应失败: %w", err)
	}
	code := -1
	if shell.Code != nil {
		code = *shell.Code
	}
	if (code != 0 && code != 200) || (shell.Success != nil && !*shell.Success) {
		return "", 0, fmt.Errorf("业务 token 兑换被拒(code=%d): %s", code, firstNonEmpty(shell.Msg, "未知错误"))
	}
	bt := firstNonEmpty(shell.Data.AccessToken, shell.Data.AccessToken2)
	if bt == "" {
		return "", 0, fmt.Errorf("业务 token 响应缺少 access_token")
	}
	expiry := int64(0)
	if shell.Data.ExpiresIn > 0 {
		expiry = time.Now().Unix() + shell.Data.ExpiresIn
	}
	return bt, expiry, nil
}

// GET /api/llm/glm/models?provider=zai — 用账号 token 拉 balance,模型 ID 取
// 各套餐额度桶 capabilities 的并集。
func (s *Server) glmModels(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	provider := r.URL.Query().Get("provider")
	if !glmProviders[provider] {
		provider = "zai"
	}
	tok, ok := s.glmToken(pg, provider)
	if !ok {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "尚未登录 GLM 账号"})
		return
	}
	deviceMid, err := s.glmDeviceMid(pg)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "生成设备标识失败: " + err.Error()})
		return
	}
	url := glmZcodeAPIBase + "/zcode-plan/billing/balance?app_version=" + glmAppVersion
	payload, err := glmCall(r.Context(), http.MethodGet, url, nil, "", tok, deviceMid)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": "解析余额响应失败: " + err.Error()})
		return
	}
	seen := map[string]bool{}
	var models []string
	for _, raw := range jsonFindStringSlice(m, "capabilities") {
		// capabilities 是 "model:glm-5.3-flash" 形态的权益 URI,剥前缀并规范化成
		// ZCode 官方 wire ID(大写驼峰,与 builtin 注册表一致)。
		id := glmCanonicalModelID(raw)
		if id == "" || seen[strings.ToLower(id)] {
			continue
		}
		seen[strings.ToLower(id)] = true
		models = append(models, id)
	}
	if models == nil {
		models = []string{}
	}
	var planIDs []string
	for _, id := range jsonFindStringSlice(m, "plan_id") {
		if !seen[id+"#plan"] {
			seen[id+"#plan"] = true
			planIDs = append(planIDs, id)
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "models": models, "plans": planIDs})
}

// glmCanonicalModelID 把权益 capability URI 归一成 ZCode 官方模型 ID
// (与 packages/shared/src/official-glm-model-id.ts 的名单保持一致)。
func glmCanonicalModelID(raw string) string {
	id := strings.TrimSpace(raw)
	if strings.HasPrefix(strings.ToLower(id), "model:") {
		id = strings.TrimSpace(id[len("model:"):])
	}
	if id == "" {
		return ""
	}
	switch strings.ToLower(id) {
	case "glm-5.3":
		return "GLM-5.3"
	case "glm-5.3-flash":
		return "GLM-5.3-Flash"
	case "glm-5v-turbo":
		return "GLM-5V-Turbo"
	case "glm-5.2":
		return "GLM-5.2"
	case "glm-5.1":
		return "GLM-5.1"
	case "glm-5.1-highspeed":
		return "GLM-5.1-Highspeed"
	case "glm-5":
		return "GLM-5"
	case "glm-5-turbo":
		return "GLM-5-Turbo"
	case "glm-4.7":
		return "GLM-4.7"
	case "glm-4.7-flashx":
		return "GLM-4.7-FlashX"
	case "glm-4.7-flash":
		return "GLM-4.7-Flash"
	case "glm-4.6":
		return "GLM-4.6"
	case "glm-4.5-air":
		return "GLM-4.5-Air"
	case "glm-4.5":
		return "GLM-4.5"
	}
	return id
}

// POST /api/llm/glm/logout {provider} — 清掉本地凭据(后端无 cancel 接口,flow 靠
// TTL 过期;token 本身不撤销,重新登录即覆盖)。
func (s *Server) glmLogout(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var req struct {
		Provider string `json:"provider"`
	}
	if err := decode(r, &req); err != nil || !glmProviders[req.Provider] {
		writeErr(w, 400, "provider 必须是 zai 或 bigmodel")
		return
	}
	_ = pg.SetSetting(fmt.Sprintf(glmTokenKeyFmt, req.Provider), "")
	_ = pg.SetSetting(fmt.Sprintf(glmAccessKeyFmt, req.Provider), "")
	_ = pg.SetSetting(fmt.Sprintf(glmOAuthKeyFmt, req.Provider), "")
	_ = pg.SetSetting(fmt.Sprintf(glmUserKeyFmt, req.Provider), "")
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- helpers ----------

// glmDeviceMid 读取(或首次生成)设备标识。ZCode 语义:每运行时一个随机 UUID,
// balance 接口必填(X-Device-Mid),缺失返回 400 code=3001。
func (s *Server) glmDeviceMid(pg *db.DB) (string, error) {
	if v, ok, err := pg.GetSetting(glmDeviceKey); err == nil && ok && v != "" {
		return v, nil
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // uuid v4
	b[8] = (b[8] & 0x3f) | 0x80
	id := fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
	if err := pg.SetSetting(glmDeviceKey, id); err != nil {
		log.Printf("[glm] 设备标识落库失败(本次会话内仍可用): %v", err)
	}
	return id, nil
}

func glmRandomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	return hexEncode(b)
}

func hexEncode(b []byte) string {
	const hexDigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexDigits[v>>4]
		out[i*2+1] = hexDigits[v&0x0f]
	}
	return string(out)
}

// glmPlanBaseURL 返回品牌+套餐对应的 Anthropic 推理端点(ZCode builtin 配置)。
// plan: "coding"(个人/团队 Coding Plan) | "start"(免费体验 Start Plan)。
func glmPlanBaseURL(provider, plan string) string {
	if plan == "start" {
		return glmStartPlanAnthropic
	}
	if provider == "bigmodel" {
		return glmBigModelCodingAnthropic
	}
	return glmZaiCodingAnthropic
}

// glmBrandForBaseURL 从 profile 的 base_url 识别 GLM 端点形态,决定注入哪个凭据:
//   - zcode-plan 网关(Start Plan) → ZCode JWT
//   - api.z.ai(Z.AI Coding Plan)  → 业务 JWT
//   - bigmodel.cn(智谱 Coding Plan) → 业务 JWT
//
// 非 GLM 端点返回 ""。
func glmBrandForBaseURL(baseURL string) string {
	u := strings.ToLower(strings.TrimSpace(baseURL))
	switch {
	case strings.Contains(u, "zcode.z.ai"):
		return "start"
	case strings.Contains(u, "api.z.ai"):
		return "zai"
	case strings.Contains(u, "bigmodel.cn"):
		return "bigmodel"
	}
	return ""
}

// glmAuthHeader 为 GLM 端点 profile 实时解析鉴权头:每次 LLM 请求从 settings 读
// 最新凭据——重新登录后立即生效,profile 里存的旧 api_key 不会把请求拖进 401。
//   - Coding Plan 端点(api.z.ai / bigmodel.cn):Authorization: Bearer <业务 JWT>
//     + X-Coding-Plan-Api-Key: <短时项目令牌 PAT>。没有 PAT 头时网关按个人钱包
//     计费(1113),带 PAT 才走套餐额度——链路与 ZCode 的
//     packages/shared/src/project-access-token-client.ts 一致。
//   - Start Plan 网关(zcode-plan):Authorization: Bearer <ZCode JWT>。
//
// settings 无凭据时回落 profile 自己的 api_key(手工粘贴 Key 的用法)。
func (s *Server) glmAuthHeader(brand, fallbackKey string) func() [][2]string {
	return func() [][2]string {
		if s.m == nil || s.m.pg == nil {
			return nil
		}
		var keys []string
		switch brand {
		case "start":
			// start 网关按 ZCode JWT 鉴权;品牌无法从共享的 zcode 域名区分,先 zai 后 bigmodel。
			keys = []string{fmt.Sprintf(glmTokenKeyFmt, "zai"), fmt.Sprintf(glmTokenKeyFmt, "bigmodel")}
		case "bigmodel":
			keys = []string{fmt.Sprintf(glmAccessKeyFmt, "bigmodel"), fmt.Sprintf(glmTokenKeyFmt, "bigmodel")}
		default:
			keys = []string{fmt.Sprintf(glmAccessKeyFmt, "zai"), fmt.Sprintf(glmTokenKeyFmt, "zai")}
		}
		tok := ""
		for _, key := range keys {
			if v, ok, err := s.m.pg.GetSetting(key); err == nil && ok && v != "" {
				tok = v
				break
			}
		}
		if tok == "" {
			if fallbackKey = strings.TrimSpace(fallbackKey); fallbackKey != "" {
				return [][2]string{{"Authorization", "Bearer " + fallbackKey}}
			}
			return nil
		}
		pairs := [][2]string{{"Authorization", "Bearer " + tok}}
		if brand == "zai" || brand == "bigmodel" {
			if pat := s.glmProjectToken(brand, tok); pat != "" {
				pairs = append(pairs, [2]string{"X-Coding-Plan-Api-Key", pat})
			}
		}
		return pairs
	}
}

type glmPATEntry struct {
	token     string
	expiresAt time.Time
}

// glmProjectToken 取(必要时铸造)Coding Plan 短时项目令牌,进程内缓存到过期前
// 5 分钟。链路:getCustomerInfo(选默认机构/项目)→ api_keys 找/建 "zcode-api-key"
// → POST access_tokens。businessToken 为空或任一步失败都返回 ""(让请求以无 PAT
// 的形态发出,错误可见),不影响主鉴权头。
func (s *Server) glmProjectToken(brand, businessToken string) string {
	if businessToken == "" {
		return ""
	}
	s.glmPatMu.Lock()
	defer s.glmPatMu.Unlock()
	if s.glmPAT == nil {
		s.glmPAT = map[string]glmPATEntry{}
	}
	if e := s.glmPAT[brand]; e.token != "" && time.Now().Before(e.expiresAt.Add(-5*time.Minute)) {
		return e.token
	}
	origin := glmZaiBizAPIBase
	if brand == "bigmodel" {
		origin = glmBigModelBizAPIBase
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// ① customerInfo——鉴权头是【裸】业务 token,不能加 Bearer 前缀(ZCode 注释:
	// "customerInfo 要求裸业务 token;Bearer 格式拒绝会被误判为登录失效")。
	info, err := glmBizCall(ctx, http.MethodGet, origin+"/api/biz/customer/getCustomerInfo", nil, businessToken)
	if err != nil {
		log.Printf("[glm] customerInfo 失败: %v", err)
		return ""
	}
	var customer struct {
		Organizations []struct {
			OrganizationID string `json:"organizationId"`
			Projects       []struct {
				ProjectID string `json:"projectId"`
			} `json:"projects"`
		} `json:"organizations"`
	}
	if err := json.Unmarshal(info, &customer); err != nil {
		log.Printf("[glm] customerInfo 解析失败: %v", err)
		return ""
	}
	var orgID, projID string
	for _, org := range customer.Organizations {
		if org.OrganizationID != "" && len(org.Projects) > 0 {
			orgID, projID = org.OrganizationID, org.Projects[0].ProjectID
			break
		}
	}
	if orgID == "" || projID == "" {
		log.Printf("[glm] 账号下没有可用机构/项目")
		return ""
	}

	// ② api_keys 列表——找名为 zcode-api-key 的条目,没有就创建(usageScene:1=套餐)。
	keyURL := fmt.Sprintf("%s/api/biz/v1/organization/%s/projects/%s/api_keys", origin, orgID, projID)
	listRaw, err := glmBizCall(ctx, http.MethodGet, keyURL, nil, "Bearer "+businessToken)
	if err != nil {
		log.Printf("[glm] api_keys 读取失败: %v", err)
		return ""
	}
	var keyList struct {
		Data []struct {
			APIKey string `json:"apiKey"`
			Name   string `json:"name"`
		} `json:"data"`
	}
	_ = json.Unmarshal(listRaw, &keyList)
	apiKeyID := ""
	for _, k := range keyList.Data {
		if k.Name == "zcode-api-key" && k.APIKey != "" {
			apiKeyID = k.APIKey
			break
		}
	}
	if apiKeyID == "" {
		created, err := glmBizCall(ctx, http.MethodPost, keyURL,
			map[string]any{"name": "zcode-api-key", "usageScene": 1}, "Bearer "+businessToken)
		if err != nil {
			log.Printf("[glm] zcode-api-key 创建失败: %v", err)
			return ""
		}
		var ck struct {
			Data struct {
				APIKey string `json:"apiKey"`
			} `json:"data"`
		}
		if err := json.Unmarshal(created, &ck); err != nil || ck.Data.APIKey == "" {
			log.Printf("[glm] zcode-api-key 创建响应无 apiKey")
			return ""
		}
		apiKeyID = ck.Data.APIKey
	}

	// ③ 铸短时项目令牌(~5 小时有效)。
	patRaw, err := glmBizCall(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/biz/v1/organization/%s/projects/%s/api_keys/%s/access_tokens", origin, orgID, projID, apiKeyID),
		map[string]any{"clientType": "zcode", "clientVersion": glmAppVersion}, "Bearer "+businessToken)
	if err != nil {
		log.Printf("[glm] 项目令牌铸造失败: %v", err)
		return ""
	}
	var pat struct {
		Data struct {
			AccessToken string `json:"accessToken"`
			ExpiresIn   int64  `json:"expiresIn"`
		} `json:"data"`
	}
	if err := json.Unmarshal(patRaw, &pat); err != nil || pat.Data.AccessToken == "" {
		log.Printf("[glm] 项目令牌响应无 accessToken")
		return ""
	}
	expiry := time.Now().Add(4 * time.Hour)
	if pat.Data.ExpiresIn > 0 {
		expiry = time.Now().Add(time.Duration(pat.Data.ExpiresIn) * time.Second)
	}
	s.glmPAT[brand] = glmPATEntry{token: pat.Data.AccessToken, expiresAt: expiry}
	log.Printf("[glm] 项目令牌已就绪(%s,约 %d 分钟)", brand, int(time.Until(expiry).Minutes()))
	return pat.Data.AccessToken
}

// glmBizCall 调 Z.AI/BigModel 业务 API(/api/biz/*):响应壳 {code:0|200, data}。
// authValue 原样作为 Authorization 头(customerInfo 要求裸 token,其余走 Bearer)。
func glmBizCall(ctx context.Context, method, url string, body any, authValue string) (json.RawMessage, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, rd)
	if err != nil {
		return nil, err
	}
	if authValue != "" {
		req.Header.Set("Authorization", authValue)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "ZCode/"+glmAppVersion)
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("业务 API 返回 HTTP %d: %s", resp.StatusCode, dsClip(string(raw)))
	}
	var shell struct {
		Code    *int            `json:"code"`
		Msg     string          `json:"msg"`
		Data    json.RawMessage `json:"data"`
		BizData json.RawMessage `json:"biz_data"`
	}
	if err := json.Unmarshal(raw, &shell); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if shell.Code != nil && *shell.Code != 0 && *shell.Code != 200 {
		return nil, fmt.Errorf("业务错误 %d: %s", *shell.Code, firstNonEmpty(shell.Msg, "未知错误"))
	}
	if len(shell.Data) > 0 {
		return shell.Data, nil
	}
	return json.RawMessage(raw), nil
}
