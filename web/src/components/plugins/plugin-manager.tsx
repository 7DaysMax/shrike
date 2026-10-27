"use client";
import * as React from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PluginPackage } from "@/lib/plugins/types";
import { usePluginHost } from "./plugin-host";
import { useWorkbench } from "@/components/dsh/workbench-context";
export function PluginManager() {
  const { items, kernel, error, refresh, setEnabled } = usePluginHost(),
    wb = useWorkbench();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState("");
  async function install(p: PluginPackage) {
    setBusy("install");
    try {
      const result = await api.installPlugin(p);
      await refresh();
      toast.success(`${result.installed} 已安装，默认停用；查看权限后启用`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="dsh-manage-page">
      <header className="dsh-page-heading">
        <div>
          <h1>插件</h1>
          <p>统一管理模块生命周期、贡献点和宿主服务权限。MCP、技能与自定义工具仍保留原管理入口。</p>
        </div>
        <div className="dsh-plugin-actions">
          <input
            type="file"
            accept=".json,application/json"
            hidden
            ref={input}
            onChange={async (event) => {
              const f = event.target.files?.[0];
              event.target.value = "";
              if (!f) return;
              if (f.size > 16 * 1024 * 1024) {
                toast.error("插件包文件超过 16 MiB");
                return;
              }
              try {
                await install(JSON.parse(await f.text()));
              } catch (e) {
                toast.error(`插件包格式错误：${(e as Error).message}`);
              }
            }}
          />
          <button
            type="button"
            className="dsh-primary-button"
            disabled={busy !== ""}
            onClick={() => input.current?.click()}
          >
            安装插件包
          </button>
          <button
            type="button"
            className="dsh-text-button"
            disabled={busy !== ""}
            onClick={async () => {
              try {
                const res = await fetch("/examples/task-board.artex-plugin.json");
                if (!res.ok) throw new Error("示例包读取失败");
                await install(await res.json());
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            安装示例
          </button>
          <button
            className="dsh-text-button"
            type="button"
            onClick={() => void refresh().catch((e) => toast.error(e.message))}
          >
            刷新
          </button>
        </div>
      </header>
      {error && (
        <p className="dsh-inline-error" role="alert">
          插件宿主状态读取失败：{error}
        </p>
      )}
      <div className="dsh-plugin-list">
        {items.map((item) => {
          const m = item.manifest,
            status = kernel.status(m.id);
          let stateLabel = "已停用";
          if (item.enabled) stateLabel = status?.state === "active" ? "已启用" : "加载中 / 检查诊断";
          let actionLabel = item.enabled ? "停用" : "启用";
          if (busy === m.id) actionLabel = "更新中…";
          if (m.required) actionLabel = "宿主模块";
          return (
            <article key={m.id}>
              <div>
                <h3>{m.name}</h3>
                <code>
                  {m.id} · {m.version}
                </code>
                <p>
                  {m.description ||
                    `${item.source === "builtin" ? "内置模块" : "本地插件包"} · ${m.contributions?.length ?? 0} 个贡献点`}
                </p>
                <p>
                  {stateLabel} · 依赖：
                  {m.dependencies?.join(", ") || "无"}
                </p>
                <details>
                  <summary className="text-muted-foreground text-xs">贡献点与权限</summary>
                  <ul className="mt-2 text-xs">
                    {m.contributions?.map((c) => (
                      <li key={`${c.point}:${c.id}`}>
                        {c.point} · {c.id} · {c.label}
                      </li>
                    ))}
                  </ul>
                  <p className="dsh-plugin-permissions">宿主权限：{m.permissions?.join(", ") || "无"}</p>
                </details>
                {(item.error || status?.error) && (
                  <p role="alert" className="dsh-plugin-diagnostics">
                    {item.error || status?.error}
                  </p>
                )}
              </div>
              <div className="dsh-plugin-actions">
                {item.versions.length > 1 && (
                  <select
                    aria-label={`${m.name} 版本`}
                    value={m.version}
                    disabled={busy !== ""}
                    onChange={async (e) => {
                      setBusy(m.id);
                      try {
                        await setEnabled(m.id, item.enabled, e.target.value);
                      } catch (err) {
                        toast.error((err as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {item.versions.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                )}
                <button
                  className="dsh-text-button"
                  type="button"
                  disabled={m.required || busy !== "" || !!item.error}
                  onClick={async () => {
                    const open = wb.state.tabs.some(
                      (t) =>
                        wb.dirtyTabs[t.id] &&
                        (t.pluginId === m.id ||
                          (m.contributions ?? []).some((c) => c.point === "panel" && c.id === t.kind)),
                    );
                    if (item.enabled && open) {
                      toast.error("请先保存该插件面板中的修改，再停用插件");
                      return;
                    }
                    setBusy(m.id);
                    try {
                      await setEnabled(m.id, !item.enabled);
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {actionLabel}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <footer className="mt-6 flex flex-wrap gap-3 text-xs">
        <button type="button" className="dsh-text-button" onClick={() => wb.setSettings("mcp")}>
          管理 MCP
        </button>
        <button type="button" className="dsh-text-button" onClick={() => wb.setSettings("skills")}>
          管理技能
        </button>
        <button type="button" className="dsh-text-button" onClick={() => wb.setSettings("tools")}>
          管理自定义工具
        </button>
      </footer>
    </section>
  );
}
