package server

import (
	"bytes"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestUITerminalBuffer(t *testing.T) {
	term := &uiTerminal{id: "test", running: true, created: time.Now()}
	term.appendOutput([]byte("hello"))
	if got := term.snapshot(2); got.Output != "llo" || got.Cursor != 5 || got.Reset {
		t.Fatalf("snapshot=%+v", got)
	}
	term.appendOutput(bytes.Repeat([]byte("x"), uiTerminalBuffer+10))
	got := term.snapshot(0)
	if !got.Reset || len(got.Output) != uiTerminalBuffer {
		t.Fatalf("bounded snapshot: len=%d reset=%v", len(got.Output), got.Reset)
	}
	if v := term.snapshot(got.Cursor); v.Output != "" {
		t.Fatal("cursor replayed output")
	}
}
func TestUITerminalID(t *testing.T) {
	for _, id := range []string{"", "../x", "a b", strings.Repeat("a", 101)} {
		if validUITerminalID(id) {
			t.Fatalf("accepted %q", id)
		}
	}
	if !validUITerminalID("terminal:abc-123") {
		t.Fatal("valid id rejected")
	}
}
func TestUITerminalRealProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix PTY adapter")
	}
	t.Setenv("SHELL", "/bin/sh")
	m := &uiTerminalManager{}
	defer m.closeAll()
	term, err := m.create("test", t.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	same, err := m.create("test", t.TempDir(), 80, 24)
	if err != nil || same != term {
		t.Fatal("idempotent create failed")
	}
	if _, err := term.stream.Write([]byte("printf 'DSH_PTY_%s\\n' 'OK'; exit 0\n")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		v := term.snapshot(0)
		if strings.Contains(v.Output, "DSH_PTY_OK") && !v.Running {
			if v.ExitCode != 0 {
				t.Fatalf("exit=%d", v.ExitCode)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("terminal did not finish: %+v", term.snapshot(0))
}
