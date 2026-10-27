package server

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/Autumn-27/shrike/db"
)

// seedMCPPresets 一次性预置「逆向工具包」的 MCP 入口。
//
// 主力是 REA（github.com/morluto/rea，MIT）：它以 stdio MCP 形式对外提供
// 原生二进制（Ghidra / IDA / Hopper 任一 provider）、Android APK（JADX）、
// JS/Electron、浏览器抓包、pcap、固件、WASM 等分析能力，正好补上平台现在只有
// 流量 + 资产、缺「静态逆向」这条腿。
//
// 其余两个是可选件，默认 disabled：等本机把 radare2 / jadx-mcp-server 装好、
// 并且确认命令能跑起来之后，在「系统 → MCP」里打开即可，避免开机就 spawn 一个
// 必然失败的 stdio 进程刷日志。
//
// 只做一次（mcp_presets_re_v1 标记）；老库升级上来同样生效一次。
func (s *Server) seedMCPPresets() {
	const flag = "mcp_presets_re_v1"
	if v, _, _ := s.m.pg.GetSetting(flag); v == "true" {
		return
	}

	existing, err := s.m.pg.ListMCP()
	if err != nil {
		log.Printf("[mcp] 预置逆向工具包失败(读取列表): %v", err)
		return
	}
	byName := make(map[string]int64, len(existing))
	byID := make(map[int64]*db.MCPServer, len(existing))
	for _, m := range existing {
		byName[m.Name] = m.ID
		byID[m.ID] = m
	}

	// npx 默认把包下到 $HOME/.npm；容器/只读 HOME 环境会直接失败。指到 data 目录下。
	npmCache := filepath.Join(s.dataDir, "npm-cache")
	_ = os.MkdirAll(npmCache, 0o755)
	reaEnv, _ := json.Marshal(map[string]string{"npm_config_cache": npmCache})

	presets := []struct {
		server  *db.MCPServer
		agents  []string // 默认授权的 agent key
		comment string
	}{
		{
			server: &db.MCPServer{
				Name:      "rea",
				Transport: "stdio",
				Command:   "npx",
				Args:      json.RawMessage(`["-y","rea-agents@latest","mcp"]`),
				Env:       reaEnv,
				Enabled:   true,
			},
			// planner 决定要不要走静态分析，worker 真正调工具，auto 用来手动排查。
			agents:  []string{"planner", "worker", "auto"},
			comment: "REA：二进制/APK/JS/pcap 全能逆向（MIT）",
		},
		{
			server: &db.MCPServer{
				Name:      "radare2",
				Transport: "stdio",
				Command:   "r2pm",
				Args:      json.RawMessage(`["-c","r2mcp"]`),
				Enabled:   false,
			},
			agents:  []string{"worker"},
			comment: "radare2 官方 MCP（可选，需先装 radare2 + r2pm -ci r2mcp）",
		},
		{
			server: &db.MCPServer{
				Name:      "jadx",
				Transport: "stdio",
				Command:   "python3",
				Args:      json.RawMessage(`["-m","jadx_mcp_server"]`),
				Enabled:   false,
			},
			agents:  []string{"worker"},
			comment: "jadx-mcp-server（可选，需 pip install jadx-mcp-server 且 jadx-gui 带 AI 插件在跑）",
		},
	}

	for _, p := range presets {
		id, exists := byName[p.server.Name]
		if !exists {
			newID, err := s.m.pg.SaveMCP(p.server)
			if err != nil {
				log.Printf("[mcp] 预置 %s 失败: %v", p.server.Name, err)
				continue
			}
			id = newID
			log.Printf("[mcp] 已预置 %s（%s）", p.server.Name, p.comment)
		}
		// 老库升级：rea 行已存在但没带 npm 缓存 env 的，补上（否则容器里 npx 必挂）。
		// 只补 env，不动用户改过的命令/参数。
		if exists {
			if p.server.Name == "rea" {
				if old := byID[id]; old != nil && isEmptyJSONObject(old.Env) {
					old.Env = p.server.Env
					if _, err := s.m.pg.SaveMCP(old); err != nil {
						log.Printf("[mcp] 补 rea 的 npm 缓存 env 失败: %v", err)
					}
				}
			}
			continue
		}
		for _, key := range p.agents {
			a, err := s.m.pg.GetAgentByKey(key)
			if err != nil || a == nil {
				continue
			}
			if err := s.m.pg.ToggleVisibility(a.ID, "mcp", id, true); err != nil {
				log.Printf("[mcp] 授权 %s → %s 失败: %v", p.server.Name, key, err)
			}
		}
	}

	if err := s.m.pg.SetSetting(flag, "true"); err != nil {
		log.Printf("[mcp] 写预置标记失败: %v", err)
	}
}

// isEmptyJSONObject 判断一段 JSON 是否等于空对象（"{}" / "null" / 空串都算）。
func isEmptyJSONObject(raw json.RawMessage) bool {
	switch strings.TrimSpace(string(raw)) {
	case "", "{}", "null":
		return true
	}
	return false
}

// seedReverseSkills 把预置的逆向/渗透 skill 挂到 worker 上（一次性）。
// skill 只是目录，不授权给 agent 的话，agent 的提示词里根本看不到它。
func (s *Server) seedReverseSkills() {
	const flag = "re_skills_bind_v1"
	if v, _, _ := s.m.pg.GetSetting(flag); v == "true" {
		return
	}
	worker, err := s.m.pg.GetAgentByKey("worker")
	if err != nil || worker == nil {
		log.Printf("[skill] 找 worker 失败，跳过逆向 skill 绑定: %v", err)
		return
	}
	for _, name := range []string{"reverse-native", "reverse-android", "reverse-js-app", "web-pentest"} {
		if err := s.m.pg.ToggleSkillVisibility(worker.ID, name, true); err != nil {
			log.Printf("[skill] 绑定 %s → worker 失败: %v", name, err)
			continue
		}
	}
	log.Printf("[skill] 已把 reverse-native / reverse-android / reverse-js-app / web-pentest 挂到 worker")
	_ = s.m.pg.SetSetting(flag, "true")
}
