//go:build !windows

package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	webview "github.com/webview/webview_go"

	"github.com/Autumn-27/shrike/app"
)

// runUI opens the backend inside an OS webview (WKWebView / WebKitGTK) and returns
// the process exit code once the window closes.
func runUI(inst *app.Instance, devtools bool) int {
	w := webview.New(devtools)
	defer w.Destroy()
	w.SetTitle(windowTitle)
	w.SetSize(windowW, windowH, webview.HintNone)
	// The window must not open on a blank page without telling anyone: log when
	// the SPA has actually loaded, so "blank window, backend fine" is diagnosable
	// from the log file instead of guesswork.
	if err := w.Bind("__shrikeDesktopReady", func(_ string) (string, error) {
		log.Printf("[desktop] 前端已加载")
		return "ok", nil
	}); err != nil {
		log.Printf("[desktop] 绑定就绪回调失败: %v", err)
	}
	w.Init(`window.addEventListener("load", function () {
		try { window.__shrikeDesktopReady("ok"); } catch (e) {}
	});`)
	w.Navigate(inst.URL)

	// One goroutine owns both directions of the lifetime: the backend ending
	// (fatal serve error, staged restart) closes the window, and a signal closes
	// the window instead of killing the process under AppKit.
	exitCode := make(chan int, 1)
	go func() {
		exitCode <- inst.Run()
		w.Terminate()
	}()
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigs
		w.Terminate()
	}()

	w.Run() // blocks until the window closes

	// Closing the window is the desktop's quit gesture: stop the backend and let
	// its 5s graceful shutdown drain in-flight agents before the process exits.
	inst.Stop()
	select {
	case code := <-exitCode:
		return code
	default:
		return 0
	}
}

// showFatal renders a boot failure in a window, so the user sees the reason
// (unreachable database, port taken, …) rather than a process that vanishes.
func showFatal(err error, devtools bool) {
	w := webview.New(devtools)
	defer w.Destroy()
	w.SetTitle(windowTitle + " — 启动失败")
	w.SetSize(760, 480, webview.HintNone)
	w.SetHtml(fatalPage(err))
	w.Run()
}
