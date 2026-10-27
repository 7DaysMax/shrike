"use client";
import * as React from "react";
import { api } from "@/lib/api";
import { usePluginHost, PluginBoundary } from "./plugin-host";
export function PluginFrame({ pluginId, entry, context }: { pluginId: string; entry: string; context?: unknown }) {
  const frame = React.useRef<HTMLIFrameElement>(null),
    { items } = usePluginHost();
  const version = items.find((i) => i.manifest.id === pluginId)?.manifest.version ?? "";
  const session = React.useMemo(
    () => ({ pluginId, entry, version, id: crypto.randomUUID() }),
    [pluginId, entry, version],
  );
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let alive = true,
      active = 0;
    const controller = new AbortController();
    const send = (data: object) => {
      if (alive) frame.current?.contentWindow?.postMessage({ type: "artex.result", channel: session.id, ...data }, "*");
    };
    const onMessage = async (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== session.id ||
        event.data?.type !== "artex.invoke"
      )
        return;
      const { id, method, params } = event.data;
      if (typeof id !== "string" || typeof method !== "string") return;
      try {
        if (JSON.stringify(params ?? null).length > 65536) throw new Error("large");
      } catch {
        send({ id, error: "插件请求格式无效或过大" });
        return;
      }
      if (active >= 8) {
        send({ id, error: "插件请求过多" });
        return;
      }
      active++;
      try {
        send({ id, result: await api.invokePlugin(session.pluginId, method, params) });
      } catch (e) {
        send({ id, error: (e as Error).message });
      } finally {
        active--;
      }
    };
    window.addEventListener("message", onMessage, { signal: controller.signal });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [session]);
  const initialize = React.useCallback(
    () =>
      frame.current?.contentWindow?.postMessage(
        { type: "artex.init", channel: session.id, context, pluginId: session.pluginId, apiVersion: 1 },
        "*",
      ),
    [session, context],
  );
  React.useEffect(() => {
    initialize();
  }, [initialize]);
  const url = `/api/plugins/${encodeURIComponent(pluginId)}/assets/${entry.split("/").map(encodeURIComponent).join("/")}?version=${encodeURIComponent(version)}`;
  return (
    <PluginBoundary pluginId={pluginId}>
      <div className="dsh-plugin-frame">
        {error && <p role="alert">{error}</p>}
        <iframe
          key={session.id}
          ref={frame}
          src={url}
          title={`插件 ${pluginId}`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setError("");
            initialize();
          }}
          onError={() => setError("插件界面加载失败，请检查入口文件")}
        />
      </div>
    </PluginBoundary>
  );
}
