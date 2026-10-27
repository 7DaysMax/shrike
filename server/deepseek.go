package server

// DeepSeek 账号登录(系统浏览器 OAuth + PKCE)。协议与 DeepSeek 官方开源
// harness(deepseek-ai/deepseek-harness,MIT)的账号子系统一致:
//
//	POST {platform}/auth-api/v0/dsh/auth_init    → {biz_data:{authorized_url, authorize_id}}
//	浏览器打开 authorized_url(DeepSeek 官方页,页内支持密码/短信验证码/App 扫码登录)
//	GET  {redirect_uri}?code=…&state=…           (浏览器回调本服务)
//	POST {platform}/auth-api/v0/dsh/auth_exchange → 账号 token(无过期/刷新流程)
//	GET  https://api.deepseek.com/models          (x-dsh-auth-token) → 账号可用模型
//
// token 存 settings 表;LLM 请求由 agent.Config.AuthHeaderFn 实时注入
// x-dsh-auth-token 并删除 SDK 写的 Authorization 头(见 agent/provider.go)。

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Autumn-27/shrike/db"
)

const (
	// 平台(授权/账号信息)与推理(模型列表/对话)两个固定来源。推理来源同时也是
	// 账号态 profile 的 base_url(server_mgmt.go 保存时强制写死)。
	deepseekPlatformOrigin  = "https://platform.deepseek.com"
	deepseekInferenceOrigin = "https://api.deepseek.com"

	deepseekTokenKey  = "deepseek.account_token" // 账号 token(明文,与 llm_profiles.api_key 同一保密级别)

	// 官网(dsh 同款)账号信息/余额接口;响应壳 {code|biz_code, data},余额是 big.js 字符串。
	deepseekUserURL    = "https://platform.deepseek.com/auth-api/v0/users/current"
	deepseekBalanceURL = "https://platform.deepseek.com/api/v0/users/get_user_summary"

	deepseekQuotaTTL = 60 * time.Second // 官网余额缓存窗口:前端轮询全程命中缓存,不打官网
	deepseekInfoKey   = "deepseek.account_info"  // 最近一次拉到的账号信息(原始 JSON,尽力展示)
	deepseekDeviceKey = "deepseek.device_id"     // 设备标识(随机 UUID,首次登录时生成并复用)

	// auth-api 以 x-client-version 识别客户端;取 dsh 官方 npm 包当前版本。
	deepseekClientVersion = "0.2.1-rc.2"

	// 一次登录尝试的有效期:超时后回调里的 state 不再被兑换。
	deepseekLoginTTL = 10 * time.Minute
)

// deepseekPending 是一次进行中的登录尝试。回调必须命中同一 state 才会兑换,
// PKCE verifier 只在服务端——回调 URL 被截获也换不出 token。
type deepseekPending struct {
	state        string
	verifier     string
	authorizeURL string
	redirectURI  string
	createdAt    time.Time
}

// ---------- Server 侧状态(字段在 Server 结构体上) ----------

// deepseekStart 记录一次新登录尝试(覆盖旧尝试;旧回调里的 state 随即失效)。
func (s *Server) deepseekStart(p *deepseekPending) {
	s.dsMu.Lock()
	s.dsPending = p
	s.dsMu.Unlock()
}

// deepseekTake 校验并取走进行中的尝试:state 匹配且未超时才返回,否则 nil。
// 取走即失效(授权码只能兑换一次,回调也不该被重放)。
func (s *Server) deepseekTake(state string) *deepseekPending {
	s.dsMu.Lock()
	defer s.dsMu.Unlock()
	p := s.dsPending
	s.dsPending = nil
	if p == nil || p.state != state || time.Since(p.createdAt) > deepseekLoginTTL {
		return nil
	}
	return p
}

// deepseekToken 返回账号 token(进程内缓存,懒加载自 settings)。
func (s *Server) deepseekToken(pg *db.DB) (string, bool) {
	s.dsMu.Lock()
	defer s.dsMu.Unlock()
	if s.dsLoaded {
		return s.dsToken, s.dsToken != ""
	}
	tok, _, err := pg.GetSetting(deepseekTokenKey)
	if err != nil {
		return "", false
	}
	s.dsToken, s.dsLoaded = tok, true
	return tok, tok != ""
}

// deepseekSetToken 更新缓存(登录成功)。
func (s *Server) deepseekSetToken(tok string) {
	s.dsMu.Lock()
	s.dsToken, s.dsLoaded = tok, true
	s.dsMu.Unlock()
}

// deepseekForget 清空缓存(登出)。
func (s *Server) deepseekForget() {
	s.dsMu.Lock()
	s.dsToken, s.dsLoaded = "", true
	s.dsMu.Unlock()
}

// deepseekAuthHeader 是 agent.Config.AuthHeaderFn 的实现:每次 LLM 请求实时取
// 账号 token,注入 x-dsh-auth-token 并由 transport 删掉 SDK 写的 Bearer 头。
// 未登录时返回空集,transport 什么都不改(请求会因无鉴权而失败,属预期)。
func (s *Server) deepseekAuthHeader() [][2]string {
	if s.m == nil || s.m.pg == nil {
		return nil
	}
	tok, ok := s.deepseekToken(s.m.pg)
	if !ok {
		return nil
	}
	return [][2]string{{"x-dsh-auth-token", tok}}
}

// ---------- 平台请求 ----------

// deepseekClientHeaders 构造 dsh 协议要求的客户端身份头。平台以此识别客户端类型;
// SHRIKE 是 Web 服务,固定上报 web。User-Agent 必须显式带一个非默认值——平台的
// WAF 直接拦截 Go 默认的 "Go-http-client/1.1"(实测 429),报 dsh 版本即可通过。
func deepseekClientHeaders() http.Header {
	h := http.Header{}
	h.Set("User-Agent", "dsh/"+deepseekClientVersion)
	h.Set("x-client-bundle-id", "")
	h.Set("x-client-platform", "web")
	h.Set("x-client-version", deepseekClientVersion)
	h.Set("x-client-locale", "zh_CN")
	_, offset := time.Now().Zone() // 东八区 = 28800
	h.Set("x-client-timezone-offset", strconv.Itoa(offset))
	return h
}

// deepseekCall POST/GET 一次平台接口,解析统一响应壳。壳形如 {code:0,...} /
// {biz_code:0, biz_data:{...}},不同端点字段名有差异,这里宽松解析:0 视为成功,
// 业务负载优先取 biz_data,其次 data,都没有就返回原始报文。
func deepseekCall(ctx context.Context, method, url string, body any, hdr http.Header, token string) (json.RawMessage, error) {
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
	for k, vs := range hdr {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("x-dsh-auth-token", token)
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("平台返回 HTTP %d: %s", resp.StatusCode, dsClip(string(raw)))
	}
	var shell struct {
		Code    *int            `json:"code"`
		BizCode *int            `json:"biz_code"`
		Message string          `json:"message"`
		Msg     string          `json:"msg"`
		Data    json.RawMessage `json:"data"`
		BizData json.RawMessage `json:"biz_data"`
	}
	if err := json.Unmarshal(raw, &shell); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if (shell.Code != nil && *shell.Code != 0) || (shell.BizCode != nil && *shell.BizCode != 0) {
		msg := firstNonEmpty(shell.Message, shell.Msg, "未知错误")
		return nil, fmt.Errorf("平台错误: %s", msg)
	}
	payload := shell.BizData
	if len(payload) == 0 {
		payload = shell.Data
	}
	if len(payload) == 0 {
		payload = json.RawMessage(raw)
	}
	return payload, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// jsonFindString 在解码后的 JSON 里深度优先找第一个出现的字符串型 key(大小写
// 不敏感)。平台各端点的响应字段没有公开文档,账号名/余额/token 这类只能按
// 常见命名尽力提取。
func jsonFindString(v any, keys ...string) string {
	lower := make([]string, len(keys))
	for i, k := range keys {
		lower[i] = strings.ToLower(k)
	}
	var walk func(x any) string
	walk = func(x any) string {
		switch t := x.(type) {
		case map[string]any:
			for _, want := range lower {
				for k, val := range t {
					if strings.ToLower(k) == want {
						if s, ok := val.(string); ok && s != "" {
							return s
						}
						if n, ok := val.(float64); ok { // 余额等数字字段按字符串展示
							return strconv.FormatFloat(n, 'f', -1, 64)
						}
					}
				}
			}
			for _, val := range t { // 保持遍历顺序无关:子对象里继续找
				if s := walk(val); s != "" {
					return s
				}
			}
		case []any:
			for _, item := range t {
				if s := walk(item); s != "" {
					return s
				}
			}
		}
		return ""
	}
	return walk(v)
}

// ---------- handlers ----------

// POST /api/llm/deepseek/login — 发起登录,返回平台授权页地址(前端弹窗打开)。
func (s *Server) deepseekLogin(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	verifier := deepseekRandom(32)
	state := deepseekRandom(32)
	challenge := deepseekS256(verifier)
	redirectURI := s.deepseekCallbackOrigin(r) + "/oauth/callback"

	payload, err := deepseekCall(r.Context(), http.MethodPost, deepseekPlatformOrigin+"/auth-api/v0/dsh/auth_init", map[string]any{
		"code_challenge":        challenge,
		"code_challenge_method": "S256",
		"state":                 state,
		"redirect_uri":          redirectURI,
		"locale":                "zh_CN",
		"login_source":          "web",
	}, deepseekClientHeaders(), "")
	if err != nil {
		log.Printf("[deepseek] auth_init 失败: %v", err)
		writeErr(w, 502, "DeepSeek 平台连接失败: "+err.Error())
		return
	}
	var parsed map[string]any
	_ = json.Unmarshal(payload, &parsed)
	authorizeURL := jsonFindString(parsed, "authorized_url", "authorize_url")
	if authorizeURL == "" {
		writeErr(w, 502, "平台未返回授权地址(协议可能有变化,请关注 DeepSeek Harness 更新)")
		return
	}
	s.deepseekStart(&deepseekPending{
		state: state, verifier: verifier, authorizeURL: authorizeURL,
		redirectURI: redirectURI, createdAt: time.Now(),
	})
	log.Printf("[deepseek] 登录已发起,等待浏览器授权回调")
	writeJSON(w, 200, map[string]any{"authorize_url": authorizeURL})
}

// GET /api/llm/deepseek/callback — 浏览器授权后的回调。免 JWT(requireAuth 豁免):
// 鉴权靠 state 比对 + PKCE verifier 只在服务端,回调 URL 泄露也换不出 token。
func (s *Server) deepseekCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	fail := func(msg string) {
		log.Printf("[deepseek] 回调失败: %s", msg)
		deepseekResultPage(w, false, msg)
	}
	pg := s.m.pg
	if pg == nil {
		fail("数据库不可用")
		return
	}
	if code == "" {
		detail := firstNonEmpty(r.URL.Query().Get("error_description"), r.URL.Query().Get("error"))
		if detail != "" {
			fail("平台拒绝了本次授权: " + detail)
		} else {
			fail("回调缺少授权码,请回到 SHRIKE 重新发起登录")
		}
		return
	}
	pending := s.deepseekTake(state)
	if pending == nil {
		fail("登录尝试已失效或状态不匹配,请回到 SHRIKE 重新发起登录")
		return
	}
	deviceID, err := s.deepseekDeviceID(pg)
	if err != nil {
		fail("生成设备标识失败: " + err.Error())
		return
	}
	payload, err := deepseekCall(r.Context(), http.MethodPost, deepseekPlatformOrigin+"/auth-api/v0/dsh/auth_exchange", map[string]any{
		"code":          code,
		"code_verifier": pending.verifier,
		"state":         pending.state,
		"redirect_uri":  pending.redirectURI,
		"device_id":     deviceID,
		"device_model":  fmt.Sprintf("%s/%s", "web", "shrike"),
		"os_version":    "shrike",
		"login_source":  "web",
	}, deepseekClientHeaders(), "")
	if err != nil {
		fail("授权码兑换失败: " + err.Error())
		return
	}
	var parsed map[string]any
	_ = json.Unmarshal(payload, &parsed)
	token := jsonFindString(parsed, "token", "access_token", "auth_token")
	if token == "" {
		fail("平台响应中没有 token(协议可能有变化,请关注 DeepSeek Harness 更新)")
		return
	}
	if err := pg.SetSetting(deepseekTokenKey, token); err != nil {
		fail("保存 token 失败: " + err.Error())
		return
	}
	s.deepseekSetToken(token)
	// 拉一次账号信息存下来,状态页展示用;失败不阻塞登录。
	if info, err := deepseekCall(r.Context(), http.MethodGet, deepseekPlatformOrigin+"/auth-api/v0/users/current", nil, deepseekClientHeaders(), token); err == nil {
		_ = pg.SetSetting(deepseekInfoKey, string(info))
	} else {
		log.Printf("[deepseek] 拉取账号信息失败(不影响登录): %v", err)
	}
	log.Printf("[deepseek] 账号登录成功")
	deepseekResultPage(w, true, "登录成功,请回到 SHRIKE 页面继续(此页可以关闭)")
}

// GET /api/llm/deepseek/status — 登录态 + 账号信息/余额(尽力而为)。
func (s *Server) deepseekStatus(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	token, ok := s.deepseekToken(pg)
	if !ok {
		writeJSON(w, 200, map[string]any{"authorized": false})
		return
	}
	out := map[string]any{"authorized": true}
	// 账号信息:优先用现拉的,失败退回上次存的。
	info := map[string]any{}
	if stored, _, err := pg.GetSetting(deepseekInfoKey); err == nil && stored != "" {
		_ = json.Unmarshal([]byte(stored), &info)
	}
	if cur, err := deepseekCall(r.Context(), http.MethodGet, deepseekPlatformOrigin+"/auth-api/v0/users/current", nil, deepseekClientHeaders(), token); err == nil {
		var m map[string]any
		if json.Unmarshal(cur, &m) == nil {
			info = m
			_ = pg.SetSetting(deepseekInfoKey, string(cur))
		}
	}
	out["account"] = map[string]any{
		"name":    jsonFindString(info, "username", "nickname", "name", "email"),
		"email":   jsonFindString(info, "email", "mail"),
		"id":      jsonFindString(info, "user_id", "account_id", "id"),
	}
	// 余额/用量:官网同款接口,60s 进程内缓存——前端轮询时全程命中缓存。
	out["quota"] = s.deepseekQuota(r.Context(), token)
	writeJSON(w, 200, out)
}

// deepseekQuota 拉取账号余额摘要(官网 dsh 同款接口,60s 缓存)。余额字段按
// big.js 字符串文法原样透传,提取失败时带 raw 给前端兜底展示。
func (s *Server) deepseekQuota(ctx context.Context, token string) map[string]any {
	s.dsMu.Lock()
	if s.dsQuota != nil && time.Since(s.dsQuotaAt) < deepseekQuotaTTL {
		out := s.dsQuota
		s.dsMu.Unlock()
		return out
	}
	s.dsMu.Unlock()

	out := map[string]any{"cached": false}
	if payload, err := deepseekCall(ctx, http.MethodGet, deepseekBalanceURL, nil, deepseekClientHeaders(), token); err != nil {
		out["error"] = err.Error()
	} else {
		var m map[string]any
		if json.Unmarshal(payload, &m) == nil {
			out["balance"] = jsonFindString(m, "balance", "total_balance", "remaining_balance", "credit", "remaining")
			out["raw"] = m
		}
	}

	s.dsMu.Lock()
	s.dsQuota, s.dsQuotaAt = out, time.Now()
	s.dsMu.Unlock()
	return out
}

// POST /api/llm/deepseek/logout — 远端登出(尽力而为)并清掉本地凭据。
func (s *Server) deepseekLogout(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	if token, ok := s.deepseekToken(pg); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		if _, err := deepseekCall(ctx, http.MethodPost, deepseekPlatformOrigin+"/auth-api/v0/users/logout", nil, deepseekClientHeaders(), token); err != nil {
			log.Printf("[deepseek] 远端登出失败(本地凭据仍会清除): %v", err)
		}
		cancel()
	}
	_ = pg.SetSetting(deepseekTokenKey, "")
	_ = pg.SetSetting(deepseekInfoKey, "")
	s.deepseekForget()
	writeJSON(w, 200, map[string]any{"ok": true})
}

// GET /api/llm/deepseek/models — 用账号 token 拉该账号可用的模型列表。
func (s *Server) deepseekModels(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	models, err := s.deepseekFetchModels(r.Context(), pg)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "models": models})
}

// deepseekFetchModels GET https://api.deepseek.com/models(x-dsh-auth-token)。
// dsh 同款行为:拒绝重定向(账号服务不该把列表挪走,挪了就显式失败)。
func (s *Server) deepseekFetchModels(ctx context.Context, pg *db.DB) ([]string, error) {
	token, ok := s.deepseekToken(pg)
	if !ok {
		return nil, fmt.Errorf("尚未登录 DeepSeek 账号")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, deepseekInferenceOrigin+"/models", nil)
	if err != nil {
		return nil, err
	}
	// WAF 拦 Go 默认 UA(见 deepseekClientHeaders),模型列表请求同样要带。
	req.Header.Set("User-Agent", "dsh/"+deepseekClientVersion)
	req.Header.Set("x-dsh-auth-token", token)
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("账号凭据已失效,请重新登录")
		}
		return nil, fmt.Errorf("API 返回 %d: %s", resp.StatusCode, dsClip(string(body)))
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	models := make([]string, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		if m.ID != "" {
			models = append(models, m.ID)
		}
	}
	return models, nil
}

// ---------- helpers ----------

// deepseekCallbackPort 是 dsh web 版回调监听的固定端口;平台的授权页按
// 「http://127.0.0.1:3080/oauth/callback」这一形态发起跳转,实测换成 localhost 或
// 自定义路径(8787 的 API 路径)授权页会直接报「授权失败」、根本不回调。
const deepseekCallbackPort = 3080

// deepseekCallbackOrigin 返回回调监听的 origin,首次使用时启动专用监听。
// 形态完全对齐 dsh:3080 端口 + /oauth/callback;实测换成 localhost 或自定义路径
// (8787 的 API 路径)授权页会直接报「授权失败」、根本不回调。
// 监听绑 :3080(容器内全网卡)而非 127.0.0.1——SHRIKE 跑在 Docker 里时,发布端口
// 转发的是容器 eth0 而非容器回环;宿主机侧由 compose 只发布 127.0.0.1:3080,
// 不会暴露到局域网。3080 被占用(比如本机真的在跑 dsh web)则回落到主服务端口。
func (s *Server) deepseekCallbackOrigin(r *http.Request) string {
	s.dsCbOnce.Do(func() {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /oauth/callback", s.deepseekCallback)
		srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
		if ln, err := net.Listen("tcp", fmt.Sprintf(":%d", deepseekCallbackPort)); err == nil {
			s.dsCbOrigin = fmt.Sprintf("http://127.0.0.1:%d", deepseekCallbackPort)
			go func() { _ = srv.Serve(ln) }()
			log.Printf("[deepseek] 本地回调监听已启动: %s/oauth/callback", s.dsCbOrigin)
			return
		}
		port := deepseekRequestPort(r)
		s.dsCbOrigin = fmt.Sprintf("http://127.0.0.1:%d", port)
		log.Printf("[deepseek] %d 端口被占用,回调回落到 %s/oauth/callback", deepseekCallbackPort, s.dsCbOrigin)
	})
	return s.dsCbOrigin
}

// deepseekRequestPort 从请求 Host 里取端口(无端口时 8787)。
func deepseekRequestPort(r *http.Request) int {
	if _, port, err := net.SplitHostPort(r.Host); err == nil {
		if p, err := strconv.Atoi(port); err == nil && p > 0 {
			return p
		}
	}
	return 8787
}

// deepseekDeviceID 读取(或首次生成)设备标识。dsh 语义:同一凭据存储的进程共享
// 一个随机 UUID,不携带任何机器信息。
func (s *Server) deepseekDeviceID(pg *db.DB) (string, error) {
	if v, ok, err := pg.GetSetting(deepseekDeviceKey); err == nil && ok && v != "" {
		return v, nil
	}
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	id := fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
	if err := pg.SetSetting(deepseekDeviceKey, id); err != nil {
		log.Printf("[deepseek] 设备标识落库失败(本次会话内仍可用): %v", err)
	}
	return id, nil
}

func deepseekRandom(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand 不可用: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// deepseekS256 计算 PKCE S256 challenge:BASE64URL(SHA256(verifier))。
func deepseekS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// dsClip 收敛报文片段用于日志/错误信息,防止一个失控的响应刷爆日志或页面。
func dsClip(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "(空)"
	}
	if len(s) > 512 {
		return s[:512] + fmt.Sprintf("…(截断,共 %d 字节)", len(s))
	}
	return s
}

// deepseekResultPage 回调落地页:告诉用户回 SHRIKE 继续。免鉴权路径不引前端
// 资源,纯内联 HTML。
func deepseekResultPage(w http.ResponseWriter, ok bool, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	status := "✅"
	if !ok {
		status = "❌"
		w.WriteHeader(http.StatusUnauthorized)
	}
	fmt.Fprintf(w, `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DeepSeek 登录</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0e14;color:#e6e6e6}
.card{text-align:center;padding:2rem 3rem;border:1px solid #2a2f3a;border-radius:12px;background:#12161f}
h1{font-size:1.1rem;font-weight:600}p{color:#9aa3b2;font-size:.9rem}</style></head>
<body><div class="card"><div style="font-size:2rem">%s</div><h1>%s</h1><p>DeepSeek 账号登录 · SHRIKE</p></div>
<script>if(%t)setTimeout(function(){window.close()},1500)</script></body></html>`,
		status, msg, ok)
}
