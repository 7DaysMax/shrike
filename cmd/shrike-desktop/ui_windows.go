//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/Autumn-27/shrike/app"
)

// Windows 桌面窗口用「Chromium 的 --app 模式」实现，而不是内嵌 WebView2：
//
//   - go-webview2 需要 cgo + MSVC/MinGW 工具链和 WebView2 SDK，在 macOS 上无法
//     交叉编译，CI 里也得装一整套 Windows 工具链；
//   - Win10 1803+ 自带 Edge（Chromium 内核），`msedge --app=URL` 出来的就是一个
//     没有地址栏、没有标签页的独立窗口，和 WebView2 的观感一致；
//   - 纯 Go、CGO_ENABLED=0 就能编，产物只有一个 exe。
//
// 代价：窗口进程是 Edge 而不是我们自己，所以退出判定靠等待子进程结束。
func runUI(inst *app.Instance, _ bool) int {
	browser := findChromium()
	if browser == "" {
		// 没有 Edge/Chrome 时退化成默认浏览器打开：功能可用，只是有地址栏。
		log.Printf("[desktop] 未找到 Edge/Chrome，改用默认浏览器打开 %s", inst.URL)
		_ = exec.Command("cmd", "/c", "start", "", inst.URL).Start()
		code := inst.Run()
		return code
	}

	// 独立的 user-data-dir：不污染用户日常浏览器配置，也保证「关窗=退出」可靠
	// （复用同一 profile 时，已有窗口会被接管、进程立即退出）。
	profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "SHRIKE", "browser-profile")
	_ = os.MkdirAll(profile, 0o755)

	args := []string{
		"--app=" + inst.URL,
		"--window-size=" + itoa(windowW) + "," + itoa(windowH),
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate,MediaRouter",
	}
	cmd := exec.Command(browser, args...)
	if err := cmd.Start(); err != nil {
		log.Printf("[desktop] 启动窗口失败: %v（改用默认浏览器）", err)
		_ = exec.Command("cmd", "/c", "start", "", inst.URL).Start()
		return inst.Run()
	}
	log.Printf("[desktop] 窗口已打开: %s (%s)", inst.URL, filepath.Base(browser))

	// 后端先退出（致命错误 / 升级重启）→ 关掉窗口；窗口被用户关掉 → 停后端。
	exitCode := make(chan int, 1)
	go func() {
		code := inst.Run()
		exitCode <- code
		_ = cmd.Process.Kill()
	}()
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigs
		_ = cmd.Process.Kill()
	}()

	_ = cmd.Wait() // 窗口关掉 / 进程被杀
	inst.Stop()
	select {
	case code := <-exitCode:
		return code
	default:
		return 0
	}
}

// showFatal on Windows has no window of our own to draw into, so the error page
// goes to a temp HTML file opened by the default browser. Same information, no
// console dependency (the exe is built with -H windowsgui).
func showFatal(err error, _ bool, cfgPath string) {
	page := fatalPage(err, cfgPath)
	path := filepath.Join(os.TempDir(), "shrike-startup-error.html")
	if werr := os.WriteFile(path, []byte(page), 0o644); werr != nil {
		log.Printf("[desktop] 写错误页失败: %v（原始错误: %v）", werr, err)
		return
	}
	_ = exec.Command("cmd", "/c", "start", "", path).Start()
}

// findChromium looks for a Chromium-based browser to use as the app window.
// Edge ships with Windows 10 1803+, so the first two paths cover nearly every box.
func findChromium() string {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, c := range candidates {
		if strings.TrimSpace(c) == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// itoa avoids pulling strconv in for two call sites.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
