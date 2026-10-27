//go:build !windows

package server

import (
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

func startUITerminal(dir string, cols, rows uint16) (io.ReadWriteCloser, func(uint16, uint16) error, func(), func() int, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-i")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	terminal, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	var once sync.Once
	done := make(chan struct{})
	stop := func() {
		once.Do(func() {
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
			_ = terminal.Close()
			go func() {
				select {
				case <-done:
				case <-time.After(time.Second):
					_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				}
			}()
		})
	}
	wait := func() int {
		err := cmd.Wait()
		close(done)
		if err == nil {
			return 0
		}
		if e, ok := err.(*exec.ExitError); ok {
			return e.ExitCode()
		}
		return -1
	}
	resize := func(c, r uint16) error { return pty.Setsize(terminal, &pty.Winsize{Cols: c, Rows: r}) }
	return terminal, resize, stop, wait, nil
}
