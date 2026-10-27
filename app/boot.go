// Package app boots the SHRIKE backend once, so the headless server binary
// (cmd/shrike) and the desktop shell (cmd/shrike-desktop) start it the same way.
//
// Boot binds the listener synchronously: a port conflict surfaces as an error
// instead of a half-started process. Run then serves until the parent context is
// cancelled, Stop is called (the desktop window closed), or a staged update asks
// for a restart. The process exit code is Run's return value.
package app

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"time"

	"github.com/Autumn-27/shrike/agent"
	"github.com/Autumn-27/shrike/config"
	"github.com/Autumn-27/shrike/server"
)

// Options are the boot parameters shared by both entry points.
type Options struct {
	// Version is reported by /api/health (the headless binary injects a build tag).
	Version string
	// Addr is the HTTP listen address, e.g. ":8787" or "127.0.0.1:0" (ephemeral).
	Addr string
	// DataDir is the working dir for task artifacts and transcripts.
	DataDir string
	// ProxyAddr is the traffic-recording proxy address; empty disables it.
	ProxyAddr string
	// KeyDir is where the JWT signing key (jwt.key) lives. Empty means "next to
	// the executable" — right for the server, but a desktop .app bundle should
	// keep it in the user's support dir instead, where updates won't wipe it.
	KeyDir string
	// RestartExit is the exit code used when a staged self-update asks for a
	// restart (the supervisor script relaunches us on it). Zero means the caller
	// has no update protocol — the desktop shell, where the app just exits.
	RestartExit int
}

// Instance is a running backend.
type Instance struct {
	// URL is the base URL the UI (or the desktop webview) should load.
	URL string
	// DataDir mirrors Options.DataDir.
	DataDir string
	// Workers is how many task workers the manager started.
	Workers int

	opts    Options
	cancel  context.CancelCauseFunc
	ctx     context.Context
	httpSrv *http.Server
	mgr     *server.Manager
	serveCh chan error
}

// Boot opens the stores, builds the API server and starts serving in the
// background. It returns once the listener is bound, so the caller can point a
// webview at URL immediately. A non-nil error means nothing was left running.
func Boot(parent context.Context, opts Options) (*Instance, error) {
	server.BuildVersion = opts.Version

	mgr, err := server.NewManager(opts.DataDir, opts.ProxyAddr)
	if err != nil {
		return nil, fmt.Errorf("open stores: %w", err)
	}

	ctx, cancel := abortOnCancel(parent)

	skillDir := config.SkillDir()
	if abs, e := filepath.Abs(skillDir); e == nil {
		skillDir = abs
	}
	log.Printf("[config] skill 目录: %s", skillDir)

	ln, err := net.Listen("tcp", opts.Addr)
	if err != nil {
		cancel(agent.AbortShutdown)
		mgr.Close()
		return nil, fmt.Errorf("listen %s: %w", opts.Addr, err)
	}

	keyDir := opts.KeyDir
	if keyDir == "" {
		keyDir = config.BaseDir()
	}

	inst := &Instance{
		URL:     "http://" + dialAddr(ln.Addr()),
		DataDir: opts.DataDir,
		Workers: mgr.Workers(),
		opts:    opts,
		ctx:     ctx,
		cancel:  cancel,
		mgr:     mgr,
		serveCh: make(chan error, 1),
	}
	inst.httpSrv = &http.Server{
		Addr:              ln.Addr().String(),
		Handler:           server.New(ctx, mgr, skillDir, opts.DataDir, keyDir).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("SHRIKE %s backend listening on %s (data=%s, workers=%d)",
			opts.Version, ln.Addr(), opts.DataDir, inst.Workers)
		if err := inst.httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			inst.serveCh <- err
		}
	}()

	return inst, nil
}

// Stop asks the backend to shut down. It is safe to call more than once.
func (i *Instance) Stop() { i.cancel(agent.AbortShutdown) }

// Run blocks until the backend stops and returns the process exit code.
func (i *Instance) Run() int {
	code := 0
	select {
	case <-i.ctx.Done():
	case <-server.RestartRequested():
		code = i.opts.RestartExit
		i.cancel(agent.AbortShutdown)
	case err := <-i.serveCh:
		log.Printf("serve: %v", err)
		code = 1
	}

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = i.httpSrv.Shutdown(shutdownCtx)
	i.mgr.Close()
	return code
}

// dialAddr turns a listener address into something a browser can open: ":8787"
// (all interfaces) becomes "127.0.0.1:8787", and IPv6 wildcards become "[::1]".
func dialAddr(a net.Addr) string {
	tcp, ok := a.(*net.TCPAddr)
	if !ok {
		return a.String()
	}
	host := tcp.IP.String()
	switch host {
	case "::", "0.0.0.0", "<nil>":
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, fmt.Sprint(tcp.Port))
}

// abortOnCancel derives the runtime context from a parent one, carrying
// AbortShutdown as the cancel cause. The agent runtime reports that cause up in
// every in-flight Agent, so a signal (or the desktop window closing) has to look
// like the same abort rather than a bare context.Canceled.
func abortOnCancel(parent context.Context) (context.Context, context.CancelCauseFunc) {
	ctx, cancel := context.WithCancelCause(context.Background())
	go func() {
		select {
		case <-parent.Done():
			cancel(agent.AbortShutdown)
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}
