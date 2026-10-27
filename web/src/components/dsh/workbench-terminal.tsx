"use client";

import * as React from "react";
import { IconRefresh, IconPlayerStop } from "@tabler/icons-react";
import { api } from "@/lib/api";

/** The terminal process belongs to the Go Host, not this component's lifetime. */
export function TerminalPanel({ id, active }: { id: string; active: boolean }) {
  const container = React.useRef<HTMLElement>(null);
  const fit = React.useRef<(() => void) | null>(null);
  const [error, setError] = React.useState("");
  const [running, setRunning] = React.useState(true);
  const [revision, setRevision] = React.useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reconnects this Host-owned process.
  React.useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let terminal: import("@xterm/xterm").Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let dataSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;
    let cursor = 0,
      writes = Promise.resolve();
    setError("");
    async function boot() {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !container.current) return;
        terminal = new Terminal({
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          cursorBlink: true,
          scrollback: 5000,
          screenReaderMode: true,
          theme: { background: "#17181c", foreground: "#e6e7eb", cursor: "#e6e7eb", selectionBackground: "#444751" },
        });
        const addon = new FitAddon();
        terminal.loadAddon(addon);
        terminal.open(container.current);
        const fitNow = () => {
          if (!disposed && container.current?.offsetWidth && container.current.offsetHeight) addon.fit();
        };
        fit.current = fitNow;
        fitNow();
        await api.uiTerminalCreate(id, terminal.cols, terminal.rows);
        if (disposed) return;
        dataSubscription = terminal.onData((input) => {
          writes = writes
            .then(() => api.uiTerminalWrite(id, input))
            .then(() => undefined)
            .catch((e: Error) => {
              if (!disposed) setError(e.message);
            });
        });
        resizeSubscription = terminal.onResize(({ cols, rows }) => {
          void api.uiTerminalResize(id, cols, rows).catch((e: Error) => {
            if (!disposed) setError(e.message);
          });
        });
        observer = new ResizeObserver(fitNow);
        observer.observe(container.current!);
        async function poll() {
          if (disposed) return;
          try {
            const result = await api.uiTerminalRead(id, cursor);
            if (disposed) return;
            if (result.reset) terminal?.reset();
            cursor = result.cursor;
            if (result.output_base64)
              terminal?.write(Uint8Array.from(atob(result.output_base64), (c) => c.charCodeAt(0)));
            else if (result.output) terminal?.write(result.output);
            setRunning(result.running);
            setError("");
            if (!result.running) {
              terminal?.write(`\r\n[进程已退出 · ${result.exit_code ?? 0}]\r\n`);
              return;
            }
          } catch (e) {
            if (disposed) return;
            setError((e as Error).message);
          }
          timer = setTimeout(() => void poll(), 500);
        }
        void poll();
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    }
    void boot();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      dataSubscription?.dispose();
      resizeSubscription?.dispose();
      terminal?.dispose();
      fit.current = null;
    };
  }, [id, revision]);
  React.useEffect(() => {
    if (active) {
      const frame = requestAnimationFrame(() => fit.current?.());
      return () => cancelAnimationFrame(frame);
    }
  }, [active]);
  return (
    <div className="dsh-terminal-panel">
      <div className="dsh-panel-toolbar">
        <span>{running ? "主机终端 · 工作空间" : "进程已退出"}</span>
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label="中断终端命令"
          disabled={!running}
          onClick={() => void api.uiTerminalWrite(id, "\x03").catch((e: Error) => setError(e.message))}
        >
          <IconPlayerStop size={15} />
        </button>
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label="重新连接终端"
          onClick={() => setRevision((n) => n + 1)}
        >
          <IconRefresh size={15} />
        </button>
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            重试连接
          </button>
        </div>
      )}
      <section ref={container} className="dsh-terminal-viewport" aria-label="交互式终端" />
    </div>
  );
}
