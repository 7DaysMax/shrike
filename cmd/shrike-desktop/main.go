// Command shrike-desktop runs the SHRIKE backend inside a native window: the
// same Go API and the same embedded frontend the server binary serves, only
// pointed at a webview instead of a browser tab.
//
// It is a thin shell on purpose. Everything below the window — PostgreSQL
// manager, agent runtime, HTTP API, traffic proxy — comes from package app, so a
// fix in the backend lands in the desktop build automatically.
//
// Build:
//
//	macOS/Linux: CGO_ENABLED=1 go build -tags embedui -o SHRIKE ./cmd/shrike-desktop
//	Windows:     CGO_ENABLED=0 GOOS=windows go build -tags embedui -H windowsgui
//
// (see build-desktop.sh, which assembles the .app bundle / Windows .exe.)
package main

import (
	"context"
	"flag"
	"html"
	"log"
	"os"
	"path/filepath"
	"runtime"

	"github.com/Autumn-27/shrike/app"
	"github.com/Autumn-27/shrike/config"
	"github.com/Autumn-27/shrike/server"
)

// version is injected the same way as the server binary: -X main.version=<tag>.
var version = "dev"

const (
	windowTitle = "SHRIKE"
	windowW     = 1440
	windowH     = 900
)

func main() {
	// AppKit may only be driven from the process's main thread, and the Go
	// runtime will happily move goroutine 0 elsewhere without this lock.
	runtime.LockOSThread()
	os.Exit(run())
}

func run() int {
	dataDir := flag.String("data", "", "data directory (default: <app support>/SHRIKE/data)")
	proxyAddr := flag.String("proxy", "127.0.0.1:8788", "traffic recording proxy address (empty to disable)")
	devtools := flag.Bool("debug", false, "enable webview devtools")
	home := flag.String("home", "", "支持目录（默认 <用户配置目录>/SHRIKE，可用于便携运行）")
	flag.Parse()

	base := *home
	if base == "" {
		var err error
		if base, err = appSupportDir(); err != nil {
			log.Printf("解析应用目录失败: %v", err)
			return 1
		}
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		log.Printf("创建支持目录失败: %v", err)
		return 1
	}
	if *dataDir == "" {
		*dataDir = filepath.Join(base, "data")
	}
	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Printf("创建数据目录失败: %v", err)
		return 1
	}
	prepareSupportDir(base)

	// Same log sink the server binary installs, so the /logs page works here too.
	server.StartLogCapture()

	// Ephemeral port: the desktop app must not fight a server instance (or a
	// second window) over :8787, and nothing outside the window needs to know it.
	inst, err := app.Boot(context.Background(), app.Options{
		Version:   version,
		Addr:      "127.0.0.1:0",
		DataDir:   *dataDir,
		ProxyAddr: *proxyAddr,
		KeyDir:    base,
	})
	if err != nil {
		// A desktop app that dies without a window looks like a crash. Show what
		// broke — almost always the PostgreSQL DSN — in a window instead.
		log.Printf("%v", err)
		showFatal(err, *devtools, filepath.Join(base, "config.json"))
		return 1
	}
	log.Printf("[desktop] 窗口地址: %s", inst.URL)

	// 窗口实现按平台分文件：macOS/Linux 用 webview（cgo），Windows 用
	// Edge/Chrome 的 --app 窗口（纯 Go，不需要 cgo 与 WebView2 工具链）。
	return runUI(inst, *devtools)
}

// fatalPage is the standalone error document. It pulls no assets and no fonts:
// it has to render even when the backend never came up.
func fatalPage(err error, cfgPath string) string {
	msg := html.EscapeString(err.Error())
	return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<body style="margin:0;font:14px/1.6 -apple-system,'PingFang SC',sans-serif;color:#1c1917;background:#fafafa">
<div style="max-width:620px;margin:0 auto;padding:64px 32px">
  <div style="font-size:12px;letter-spacing:.32em;color:#7c3aed;font-weight:600">SHRIKE</div>
  <h1 style="font-size:22px;margin:8px 0 4px">后端启动失败</h1>
  <p style="color:#57534e">窗口已打开，但 API 服务没能起来。下面这条是根因：</p>
  <pre style="white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:14px;color:#b91c1c">` + msg + `</pre>
  <h2 style="font-size:15px;margin-top:28px">怎么修</h2>
  <ul style="color:#57534e;padding-left:20px">
    <li>确认 PostgreSQL 在跑（Windows 装完默认端口 <b>5432</b>，不是 5433），且配置文件里的 host/port/user/password/dbname 对得上。</li>
    <li>或者设环境变量 <code>SHRIKE_PG_DSN</code> 直接给完整连接串，例如<br>
        <code>postgres://shrike:shrike@127.0.0.1:5432/shrike?sslmode=disable</code></li>
    <li>配置文件：<code>` + html.EscapeString(cfgPath) + `</code></li>
  </ul>
  <p style="color:#a8a29e;font-size:12px;margin-top:28px">改完重新打开本应用即可。</p>
</div></body></html>`
}

// prepareSupportDir points SHRIKE at a writable per-user directory. The .app
// bundle is read-only (and on macOS may even live on a read-only volume), so
// config.json and skills are seeded into the support dir on first run instead of
// being read from next to the executable.
func prepareSupportDir(base string) {
	if os.Getenv("SHRIKE_CONFIG") == "" {
		cfgPath := filepath.Join(base, "config.json")
		if _, err := os.Stat(cfgPath); err != nil {
			seedConfig(cfgPath, base)
		}
		if err := os.Setenv("SHRIKE_CONFIG", cfgPath); err == nil {
			log.Printf("[desktop] 配置文件: %s", cfgPath)
		}
	}

	if os.Getenv("SHRIKE_SKILL_DIR") == "" {
		skillDst := filepath.Join(base, "skills")
		if err := os.MkdirAll(skillDst, 0o755); err == nil {
			seedSkills(skillDst)
			_ = os.Setenv("SHRIKE_SKILL_DIR", skillDst)
		}
	}
}

// seedConfig writes a first-run config.json: an existing config.json from the
// development tree is copied when present (so a dev running the desktop shell
// hits the same database), otherwise a local-PostgreSQL template is written.
func seedConfig(dst, base string) {
	if src := config.Path(); src != dst {
		if b, err := os.ReadFile(src); err == nil {
			if os.WriteFile(dst, b, 0o600) == nil {
				log.Printf("[desktop] 已套用现有配置 %s → %s", src, dst)
				return
			}
		}
	}
	tpl := `{
  "database": {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "shrike",
    "password": "",
    "dbname": "shrike",
    "sslmode": "disable"
  },
  "_comment": "改这里的 host/port/user/password/dbname 指向你的 PostgreSQL；也可以在系统里设环境变量 SHRIKE_PG_DSN 直接给完整连接串（优先级更高）。",
  "skill_dir": "` + filepath.ToSlash(filepath.Join(base, "skills")) + `"
}
`
	if err := os.WriteFile(dst, []byte(tpl), 0o600); err != nil {
		log.Printf("[desktop] 写入 %s 失败: %v", dst, err)
		return
	}
	log.Printf("[desktop] 已生成初始配置 %s（数据库指向 127.0.0.1:5433）", dst)
}

// seedSkills copies the skills bundled inside the app into the support dir once.
// An existing non-empty skill dir is left alone: users edit those files.
func seedSkills(dst string) {
	if entries, err := os.ReadDir(dst); err == nil && len(entries) > 0 {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// <bundle>/Contents/MacOS/shrike-desktop → <bundle>/Contents/Resources/skills
	src := filepath.Join(filepath.Dir(exe), "..", "Resources", "skills")
	if _, err := os.Stat(src); err != nil {
		return // running from the build tree: fall back to BaseDir()/skills
	}
	if err := copyTree(src, dst); err != nil {
		log.Printf("[desktop] 复制 skill 失败: %v", err)
		return
	}
	log.Printf("[desktop] 已释放内置 skill 到 %s", dst)
}

// appSupportDir is <user config dir>/SHRIKE — ~/Library/Application Support on
// macOS, %AppData% on Windows, ~/.config on Linux.
func appSupportDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	base := filepath.Join(dir, "SHRIKE")
	return base, os.MkdirAll(base, 0o755)
}
