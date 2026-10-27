"use client";

import * as React from "react";

import dynamic from "next/dynamic";
import Link from "next/link";

import { IconArrowLeft, IconPlayerPause, IconPlayerPlay, IconTarget } from "@tabler/icons-react";
import { toast } from "sonner";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { StatusBadge } from "@/components/status-badge";
import { TaskLLMControl } from "@/components/task-llm-control";
import { Transcript } from "@/components/transcript";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Activity, Conversation, LLMProfile, Task, TaskCategory } from "@/lib/types";

import type { InferenceSettings } from "@/lib/dsh/inference";
import type { TaskSection } from "./task-inspector";
import { useWorkbench } from "./workbench-context";

const Sessions = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/sessions-tab").then((m) => m.SessionsTab),
  { loading: () => <p className="dsh-panel-message">正在加载任务主会话…</p> },
);
const Form = dynamic(() => import("@/components/task-create-form").then((m) => m.TaskCreateForm), {
  loading: () => <p className="dsh-panel-message">正在加载任务草案…</p>,
});

export function TaskDraft({
  conv,
  profiles,
  onCreated,
  onCancel,
}: {
  conv?: Conversation;
  profiles: LLMProfile[];
  onCreated: (c: Conversation) => void;
  onCancel: () => void;
}) {
  const [resources, setResources] = React.useState<{
    tasks: Task[];
    categories: TaskCategory[];
    inference?: InferenceSettings;
    profileId?: number;
  }>();
  const [error, setError] = React.useState("");
  const createdConv = React.useRef<number | undefined>(conv?.id);
  const load = React.useCallback(() => {
    setError("");
    Promise.all([
      api.tasks(),
      api.taskCategories(),
      conv ? api.uiInference("conversation", conv.id) : Promise.resolve(null),
    ])
      .then(([t, c, i]) =>
        setResources({
          tasks: t.tasks,
          categories: c,
          inference: i?.settings,
          profileId: i?.effective ? Number(i.effective.id) : undefined,
        }),
      )
      .catch((e) => setError(e.message));
  }, [conv?.id]);
  React.useEffect(load, [load]);
  async function ensureConversation() {
    if (createdConv.current) return createdConv.current;
    // Recover the same binding after a refresh or an unknown create response.
    try {
      const saved = Number(localStorage.getItem("artex:task-draft:new:conversation"));
      if (Number.isSafeInteger(saved) && saved > 0) {
        const existing = (await api.conversations()).find((c) => c.id === saved);
        if (existing) {
          createdConv.current = saved;
          return saved;
        }
      }
    } catch {
      /* Storage is optional; server binding remains authoritative. */
    }
    const c = await api.createConversation(
      "mainagent",
      "工作会话",
      conv?.llm_profile_id ?? (Number(profiles.find((p) => p.is_default)?.id) || undefined),
    );
    createdConv.current = c.id;
    try {
      localStorage.setItem("artex:task-draft:new:conversation", String(c.id));
    } catch {
      /* Storage may be disabled. */
    }
    return c.id;
  }
  return (
    <div className="dsh-task-draft-scroll">
      {error ? (
        <div className="dsh-inline-error" role="alert">
          {error}
          <Button onClick={load} variant="outline">
            重试
          </Button>
        </div>
      ) : resources ? (
        <Form
          key={conv?.id ?? "new"}
          {...resources}
          conversationId={conv?.id}
          defaultProfileId={resources.profileId ?? conv?.llm_profile_id}
          initialInference={resources.inference}
          ensureConversation={ensureConversation}
          onCategoriesChanged={load}
          onCancel={onCancel}
          onCreated={async (task) => {
            const c = await api.taskConversation(task.id);
            try {
              localStorage.removeItem("artex:task-draft:new:conversation");
            } catch {
              /* No storage to clear. */
            }
            onCreated(c);
          }}
        />
      ) : (
        <p className="dsh-panel-message" role="status">
          正在加载任务配置…
        </p>
      )}
    </div>
  );
}

function ConversationContext({ id }: { id: number }) {
  const [open, setOpen] = React.useState(false),
    [items, setItems] = React.useState<Activity[]>([]),
    [error, setError] = React.useState("");
  const [before, setBefore] = React.useState(0),
    [more, setMore] = React.useState(false),
    [loading, setLoading] = React.useState(false);
  const load = React.useCallback(
    async (older = false) => {
      setLoading(true);
      try {
        const r = await api.conversationHistory(id, older ? before : 0, 80);
        setItems((prev) => (older ? [...r.items, ...prev] : r.items));
        setBefore(r.items[0]?.seq ?? 0);
        setMore(r.hasMore);
        setError("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [id, before],
  );
  return (
    <section className="dsh-task-context">
      <button
        type="button"
        onClick={() => {
          if (!open && !items.length) void load();
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        创建前的对话上下文 · {open ? "收起" : "展开"}
      </button>
      {open && (
        <div className="max-h-[35svh] overflow-auto px-4 py-3">
          {error && (
            <p role="alert">
              {error}
              <Button onClick={() => void load()}>重试</Button>
            </p>
          )}
          {loading && <p role="status">正在加载…</p>}
          {more && (
            <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load(true)}>
              加载更早的对话
            </Button>
          )}
          <Transcript activity={items} chat fetchDetail={(seq) => api.conversationMsgDetail(id, seq)} />
          {!items.length && !loading && !error && (
            <p className="text-muted-foreground text-sm">这个任务直接创建，没有前置对话。</p>
          )}
        </div>
      )}
    </section>
  );
}
export function TaskWorkspace({ conv, profiles }: { conv: Conversation; profiles: LLMProfile[] }) {
  const id = String(conv.task_id),
    wb = useWorkbench();
  const [task, setTask] = React.useState<Task>(),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    try {
      setTask(await api.task(id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);
  function inspect(section: TaskSection) {
    wb.openTab({
      id: `task:${id}:${section}`,
      kind: "task",
      taskId: id,
      section,
      title: `任务 #${id} · ${({ overview: "总览", sessions: "执行会话", findings: "发现", assets: "资产", report: "报告", intercept: "审批" } as Record<string, string>)[section] ?? section}`,
    });
  }
  const profile =
    profiles.find((p) => Number(p.id) === (task?.active_llm_profile_id ?? task?.llm_profile_id)) ??
    (!task?.active_llm_profile_id && !task?.llm_profile_id ? profiles.find((p) => p.is_default) : undefined);
  return (
    <div className="dsh-task-workspace">
      <div className="dsh-task-summary">
        <header className="dsh-task-header">
          <IconTarget size={18} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-sm">{task?.name || conv.title || `任务 #${id}`}</h1>
            <p className="truncate text-muted-foreground text-xs" title={task?.goal}>
              {task?.goal || `任务 #${id}`}
            </p>
          </div>
          {task && <StatusBadge domain="task" value={task.status} />}{" "}
          {task && (
            <TaskLLMControl triggerLabel="备用模型链" task={task} profiles={profiles} onUpdated={() => void load()} />
          )}
          <Button size="sm" variant="outline" onClick={() => inspect("overview")}>
            任务详情
          </Button>
          {task && ["created", "running", "queued", "paused"].includes(task.status) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.controlTask(id, task.paused || task.status === "paused" ? "resume" : "pause");
                  await load();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {task.paused || task.status === "paused" ? <IconPlayerPlay /> : <IconPlayerPause />}
              {task.paused || task.status === "paused" ? "继续任务" : "暂停任务"}
            </Button>
          )}
        </header>
        <details className="dsh-task-context-menu">
          <summary>查看任务目标与创建前上下文</summary>
          <p className="dsh-task-goal">{task?.goal || "正在读取任务目标…"}</p>
          <ConversationContext id={conv.id} />
        </details>
      </div>
      {error ? (
        <div className="dsh-inline-error" role="alert">
          任务状态：{error}
          <Button onClick={() => void load()} size="sm">
            重试
          </Button>
          <Link href="/function/tasks">任务管理</Link>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <Sessions key={id} taskId={id} mainOnly embedded />
          </div>
        </>
      )}
    </div>
  );
}
export function OpenTaskConversation({ taskId }: { taskId: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const c = await api.taskConversation(taskId);
          window.location.assign(`/chat/?c=${c.id}`);
        } catch (e) {
          toast.error((e as Error).message);
          setBusy(false);
        }
      }}
    >
      <IconArrowLeft />
      {busy ? "正在打开…" : "在工作会话中打开"}
    </Button>
  );
}

// Existing tasks enter the same thread without cloning the task or its engine.
export function UnlinkedTasks({
  conversations,
  onJoined,
}: {
  conversations: Conversation[];
  onJoined: (c: Conversation) => void;
}) {
  const [tasks, setTasks] = React.useState<Task[]>([]),
    [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    const load = () =>
      api
        .tasks()
        .then((r) => {
          if (active) {
            setTasks(r.tasks);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const linked = new Set(conversations.map((c) => String(c.task_id ?? ""))),
    unlinked = tasks.filter((t) => !linked.has(t.id));
  if (!unlinked.length && !error) return null;
  return (
    <div className="mt-3 border-t pt-3">
      <p className="px-2 pb-1 text-muted-foreground text-xs">已有任务</p>
      {error && (
        <p role="alert" className="px-2 text-xs">
          任务列表：{error}
        </p>
      )}
      {unlinked.map((task) => (
        <button
          key={task.id}
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
          disabled={busy !== ""}
          onClick={async () => {
            setBusy(task.id);
            try {
              onJoined(await api.taskConversation(task.id));
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy("");
            }
          }}
        >
          <IconTarget size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{task.name || task.description || `任务 #${task.id}`}</span>
          <span className="shrink-0 text-muted-foreground text-xs">{busy === task.id ? "打开中…" : `#${task.id}`}</span>
        </button>
      ))}
    </div>
  );
}
