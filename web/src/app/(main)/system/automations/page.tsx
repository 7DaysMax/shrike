"use client";

import * as React from "react";
import Link from "next/link";
import { IconPlus, IconClock, IconPencil, IconTrash, IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Agent, AgentTrigger } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const defaults = {
  enabled: true,
  interval_sec: 3600,
  on_finding: false,
  on_goal_met: false,
  on_task_timeout: false,
  on_tool_call: false,
  on_task_create: false,
  interval_message: "",
  finding_message: "",
  goal_message: "",
  task_timeout_message: "",
  tool_call_message: "",
  task_create_message: "",
  tool_names: [] as string[],
};
export default function AutomationsPage() {
  const [agents, setAgents] = React.useState<Agent[]>([]),
    [items, setItems] = React.useState<AgentTrigger[]>([]);
  const [error, setError] = React.useState(""),
    [loading, setLoading] = React.useState(true),
    [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all"),
    [editing, setEditing] = React.useState<AgentTrigger | null | undefined>(undefined);
  const [agentKey, setAgentKey] = React.useState(""),
    [message, setMessage] = React.useState(""),
    [seconds, setSeconds] = React.useState(3600),
    [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState<AgentTrigger | null>(null);
  const load = React.useCallback(async () => {
    setError("");
    try {
      const all = await api.agents();
      const custom = all.filter((a) => !a.builtin);
      setAgents(custom);
      const results = await Promise.all(custom.map((a) => api.agentTriggers(a.key)));
      setItems(results.flat());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);
  const visible = items.filter(
    (item) =>
      (filter === "all" || (filter === "active" ? item.enabled : !item.enabled)) &&
      `${item.interval_message} ${item.agent_key}`.toLowerCase().includes(query.toLowerCase()),
  );
  function edit(item: AgentTrigger | null) {
    setEditing(item);
    setAgentKey(item?.agent_key ?? agents[0]?.key ?? "");
    setMessage(item?.interval_message ?? "");
    setSeconds(item?.interval_sec || 3600);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!agentKey || !message.trim() || !Number.isInteger(seconds) || seconds < 1) return;
    setSaving(true);
    try {
      const body = { ...(editing ?? defaults), interval_sec: seconds, interval_message: message.trim() };
      if (editing) await api.updateTrigger(editing.id, body);
      else await api.createTrigger(agentKey, body);
      setEditing(undefined);
      await load();
      toast.success("自动化任务已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="dsh-manage-page">
      <header className="dsh-page-heading">
        <div>
          <h1>自动化任务</h1>
          <p>定时运行自定义 Agent，沿用现有触发器与执行记录。</p>
        </div>
        <button type="button" className="dsh-primary-button" onClick={() => edit(null)} disabled={!agents.length}>
          <IconPlus size={17} />
          新建任务
        </button>
      </header>
      <div className="dsh-manage-controls">
        <label className="sr-only" htmlFor="automation-search">
          搜索自动化任务
        </label>
        <input
          id="automation-search"
          placeholder="搜索任务或 Agent"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="任务状态" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">全部任务</option>
          <option value="active">已启用</option>
          <option value="inactive">已停用</option>
        </select>
        <button type="button" className="dsh-icon-btn" aria-label="刷新自动化任务" onClick={() => void load()}>
          <IconRefresh size={17} />
        </button>
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      {loading ? (
        <div className="dsh-panel-message" role="status">
          正在加载自动化任务…
        </div>
      ) : !visible.length ? (
        <div className="dsh-panel-empty">
          <IconClock size={36} stroke={1.3} />
          <h2>{items.length ? "没有匹配的任务" : "让 Agent 定时工作"}</h2>
          <p>{agents.length ? "创建定时任务，或调整筛选条件。" : "先创建一个自定义 Agent，再配置它的定时任务。"}</p>
          {!agents.length && (
            <Link href="/system/agents" className="dsh-text-button">
              管理 Agent
            </Link>
          )}
        </div>
      ) : (
        <div className="dsh-automation-list">
          {visible.map((item) => (
            <article key={item.id}>
              <IconClock size={20} stroke={1.5} />
              <div>
                <h3>{item.interval_message || item.finding_message || item.goal_message || `触发器 #${item.id}`}</h3>
                <p>
                  {agents.find((a) => a.key === item.agent_key)?.name ?? item.agent_key}
                  {item.interval_sec > 0 ? ` · 每 ${item.interval_sec} 秒` : " · 事件触发"}
                  {item.last_fire
                    ? ` · 上次运行 ${new Date(item.last_fire).toLocaleString("zh-CN")}`
                    : " · 尚无运行记录"}
                </p>
                {(item.on_finding ||
                  item.on_goal_met ||
                  item.on_task_create ||
                  item.on_tool_call ||
                  item.on_task_timeout) && <small>包含事件触发条件；完整条件在 Agent 配置中管理。</small>}
                <Link
                  href={`/system/agents/detail?key=${encodeURIComponent(item.agent_key)}`}
                  className="dsh-text-button"
                >
                  查看 Agent 与触发条件
                </Link>
              </div>
              <label className="dsh-toggle-label">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  aria-label={`启用任务 ${item.id}`}
                  onChange={async () => {
                    try {
                      await api.updateTrigger(item.id, { ...item, enabled: !item.enabled });
                      await load();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                />
                <span>{item.enabled ? "已启用" : "已停用"}</span>
              </label>
              <button
                type="button"
                className="dsh-icon-btn"
                aria-label={`编辑任务 ${item.id}`}
                onClick={() => edit(item)}
              >
                <IconPencil size={16} />
              </button>
              <button
                type="button"
                className="dsh-icon-btn"
                aria-label={`删除任务 ${item.id}`}
                onClick={() => setDeleting(item)}
              >
                <IconTrash size={16} />
              </button>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>{editing ? "编辑自动化任务" : "新建自动化任务"}</DialogTitle>
          <DialogDescription>任务会按设置的间隔向所选 Agent 发送指令。</DialogDescription>
          <form className="dsh-simple-form" onSubmit={save}>
            <label htmlFor="automation-agent">Agent</label>
            <select
              id="automation-agent"
              value={agentKey}
              disabled={!!editing}
              onChange={(e) => setAgentKey(e.target.value)}
              required
            >
              {agents.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
            <label htmlFor="automation-message">任务指令</label>
            <textarea
              id="automation-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={4}
            />
            <label htmlFor="automation-interval">运行间隔（秒）</label>
            <input
              id="automation-interval"
              type="number"
              min={1}
              step={1}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
              required
            />
            <button type="submit" className="dsh-primary-button" disabled={saving}>
              {saving ? "正在保存…" : "保存任务"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>删除自动化任务？</DialogTitle>
          <DialogDescription>删除后停止后续触发，已有会话保留。</DialogDescription>
          <div className="dsh-dialog-actions">
            <button type="button" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              type="button"
              className="dsh-danger-button"
              disabled={saving}
              onClick={async () => {
                if (!deleting) return;
                setSaving(true);
                try {
                  await api.deleteTrigger(deleting.id);
                  setDeleting(null);
                  await load();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              删除任务
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
