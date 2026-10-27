"use client";
import * as React from "react";
import Link from "next/link";
import {
  IconArrowLeft,
  IconArrowRight,
  IconRefresh,
  IconExternalLink,
  IconBrowser,
  IconShieldCheck,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { browserAddress, type WorkbenchTab } from "@/lib/dsh/workbench";
import type { Task, InterceptPending } from "@/lib/types";
import { useWorkbench } from "./workbench-context";
export function BrowserPanel({ tab }: { tab: WorkbenchTab }) {
  const wb = useWorkbench();
  const [address, setAddress] = React.useState(tab.url ?? "");
  const [history, setHistory] = React.useState<string[]>(tab.url ? [tab.url] : []);
  const [position, setPosition] = React.useState(tab.url ? 0 : -1);
  const [revision, setRevision] = React.useState(0);
  const [error, setError] = React.useState("");
  const url = history[position];
  function go() {
    const parsed = browserAddress(address.trim());
    if (!parsed) {
      setError("请输入有效的 http:// 或 https:// 地址");
      return;
    }
    setError("");
    setHistory((h) => [...h.slice(0, position + 1), parsed]);
    setPosition(position + 1);
    setAddress(parsed);
    wb.openTab({ ...tab, url: parsed, title: new URL(parsed).host });
  }
  return (
    <div className="dsh-browser-panel">
      <div className="dsh-panel-toolbar">
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label="后退"
          disabled={position < 1}
          onClick={() => {
            setPosition(position - 1);
            setAddress(history[position - 1]);
          }}
        >
          <IconArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label="前进"
          disabled={position >= history.length - 1}
          onClick={() => {
            setPosition(position + 1);
            setAddress(history[position + 1]);
          }}
        >
          <IconArrowRight size={16} />
        </button>
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label="刷新页面"
          disabled={!url}
          onClick={() => setRevision((n) => n + 1)}
        >
          <IconRefresh size={16} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <label className="sr-only" htmlFor={`address-${tab.id}`}>
            网页地址
          </label>
          <input
            id={`address-${tab.id}`}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https:// 或 http://localhost:3000"
          />
          <button className="dsh-icon-btn" type="submit" aria-label="访问网页">
            <IconArrowRight size={16} />
          </button>
        </form>
        {url && (
          <a className="dsh-icon-btn" href={url} target="_blank" rel="noreferrer" aria-label="在外部浏览器打开">
            <IconExternalLink size={16} />
          </a>
        )}
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
        </div>
      )}
      {url ? (
        <iframe
          className="dsh-browser-frame"
          key={`${url}:${revision}`}
          src={url}
          title={`浏览 ${url}`}
          sandbox="allow-scripts allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="dsh-panel-empty">
          <IconBrowser size={32} stroke={1.3} />
          <h3>打开一个网页</h3>
          <p>输入网站或本地服务地址，在工作台内浏览。目标站点决定是否允许嵌入显示。</p>
        </div>
      )}
    </div>
  );
}
export function TasksPanel() {
  const [tasks, setTasks] = React.useState<Task[]>([]),
    [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    try {
      const r = await api.tasks();
      setTasks(r.tasks);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  return (
    <div className="dsh-panel-scroll">
      <div className="dsh-panel-toolbar">
        <span>任务与目标</span>
        <Link href="/function/tasks" className="dsh-text-button">
          全部任务
        </Link>
        <button type="button" className="dsh-icon-btn" aria-label="刷新任务" onClick={() => void load()}>
          <IconRefresh size={16} />
        </button>
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
        </div>
      )}
      {!tasks.length && !error && (
        <div className="dsh-panel-message">
          还没有任务。<Link href="/function/tasks">创建任务</Link>
        </div>
      )}
      {tasks.map((task) => (
        <article className="dsh-task-row" key={task.id}>
          <header>
            <Link href={`/function/tasks/detail?id=${encodeURIComponent(task.id)}`}>
              {task.name || task.description || `任务 ${task.id}`}
            </Link>
            <span data-status={task.status}>{task.status}</span>
          </header>
          <p>{task.goal}</p>
          <footer>
            <span>
              {task.goals_met ?? 0} / {task.goals_total ?? 0} 个目标
            </span>
            {["running", "paused", "queued"].includes(task.status) && (
              <button
                type="button"
                className="dsh-text-button"
                disabled={busy === task.id}
                onClick={async () => {
                  setBusy(task.id);
                  try {
                    await api.controlTask(task.id, task.status === "paused" ? "resume" : "pause");
                    await load();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {task.status === "paused" ? "继续" : "暂停"}
              </button>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
export function ApprovalsPanel() {
  const [items, setItems] = React.useState<InterceptPending[]>([]),
    [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState<number>();
  const load = React.useCallback(async () => {
    try {
      setItems(await api.interceptPending());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);
  async function decide(id: number, decision: "allowed" | "denied") {
    setBusy(id);
    try {
      await api.interceptDecide(id, decision);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div className="dsh-panel-scroll">
      <div className="dsh-panel-toolbar">
        <span>等待审批</span>
        <Link href="/system/intercept/approvals" className="dsh-text-button">
          审批记录
        </Link>
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
        </div>
      )}
      {!items.length && !error && (
        <div className="dsh-panel-empty">
          <IconShieldCheck size={32} stroke={1.3} />
          <h3>没有待审批的操作</h3>
          <p>需要你确认的工具执行会显示在这里。</p>
        </div>
      )}
      {items.map((item) => (
        <article className="dsh-approval-card" key={item.id}>
          <header>
            <strong>{item.tool_name}</strong>
            <span>{item.agent_name}</span>
          </header>
          <p>{item.reason}</p>
          <pre>{JSON.stringify(item.tool_input, null, 2)}</pre>
          <footer>
            <button
              type="button"
              className="dsh-text-button"
              disabled={busy === item.id}
              onClick={() => void decide(item.id, "denied")}
            >
              拒绝执行
            </button>
            <button
              type="button"
              className="dsh-primary-button"
              disabled={busy === item.id}
              onClick={() => void decide(item.id, "allowed")}
            >
              允许执行
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
