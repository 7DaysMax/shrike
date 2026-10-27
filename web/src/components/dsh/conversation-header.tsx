"use client";
import * as React from "react";

import {
  IconChevronDown,
  IconCheck,
  IconBrowser,
  IconDots,
  IconFolders,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSettings,
  IconTarget,
  IconTerminal2,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import type { Conversation } from "@/lib/types";

import css from "./upstream/ConversationRoot.module.css";
import { IconPanelLeftOutlineRegular } from "./upstream/primitives/icons";
import { useContributions } from "@/components/plugins/plugin-host";
import { usePluginActions } from "@/components/plugins/contributions";
import { TASK_NAVIGATION } from "@/lib/dsh/task-navigation";
import { useWorkbench } from "./workbench-context";
export function ConversationHeader({
  title = "新会话",
  conversation,
  onCreateTask,
  drafting = false,
  onRefresh,
  views = true,
}: {
  title?: string;
  conversation?: Conversation;
  onCreateTask?: () => void;
  drafting?: boolean;
  onRefresh?: () => void;
  views?: boolean;
}) {
  const wb = useWorkbench(),
    sidebar = useSidebar();
  const panelEntries = useContributions("view"),
    panelActions = usePluginActions();
  const taskUI = useContributions("panel").some((c) => c.pluginId === "artex.tasks-ui");
  const viewIcons: Record<string, typeof IconFolders> = {
    files: IconFolders,
    terminal: IconTerminal2,
    browser: IconBrowser,
  };
  const [busy, setBusy] = React.useState(false);
  const task = conversation?.task_id;
  const taskPanel = (section: string) =>
    wb.openTab({
      id: `task:${task}:${section}`,
      kind: "task",
      taskId: String(task),
      section,
      title: `任务 #${task} · ${TASK_NAVIGATION.find((item) => item.id === section)?.label ?? "任务详情"}`,
    });
  const activePanel = wb.state.tabs.find((t) => t.id === wb.state.active);
  const status = conversation?.task_status;
  const label = (
    {
      running: "运行中",
      paused: "已暂停",
      created: "已创建",
      queued: "排队中",
      done: "已完成",
      failed: "执行失败",
      timeout: "已超时",
      archived: "已归档",
    } as Record<string, string>
  )[status ?? ""];
  return (
    <header className={`${css.header} dsh-conversation-header`} data-dsh-chrome="conversation">
      <div className={css.headerLeading}>
        {sidebar.state === "collapsed" || sidebar.isMobile ? (
          <button type="button" className="dsh-icon-btn" aria-label="展开侧栏" onClick={sidebar.toggleSidebar}>
            <IconPanelLeftOutlineRegular size={16} />
          </button>
        ) : null}
      </div>
      <div className={css.titleRow}>
        <div className={css.titleCluster}>
          <h1 className="min-w-0 truncate font-medium text-sm" title={title}>
            {title}
          </h1>
          {label && (
            <span className="dsh-status-label" data-running={status === "running" || undefined}>
              {label}
            </span>
          )}
        </div>
        <div className={css.headerActions}>
          {!task && onCreateTask && (
            <button
              className="dsh-header-text-action"
              type="button"
              disabled={conversation?.running}
              onClick={onCreateTask}
            >
              <IconPlus size={14} />
              {drafting ? "返回对话" : "创建任务"}
            </button>
          )}
          {task && taskUI && (
            <button className="dsh-header-text-action" type="button" onClick={() => taskPanel("overview")}>
              <IconTarget size={14} />
              任务详情
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="dsh-icon-btn" aria-label="会话操作">
                <IconDots size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {task && taskUI && (
                  <>
                    <DropdownMenuItem onClick={() => taskPanel("sessions")}>执行过程</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => taskPanel("findings")}>发现与资产</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => taskPanel("report")}>报告</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => window.location.assign(`/function/tasks/detail?id=${task}&view=manage`)}
                    >
                      任务管理与归档
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy || !["running", "paused", "created", "queued"].includes(status ?? "")}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.controlTask(String(task), status === "paused" ? "resume" : "pause");
                          onRefresh?.();
                        } catch (e) {
                          toast.error((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {status === "paused" ? <IconPlayerPlay size={15} /> : <IconPlayerPause size={15} />}{" "}
                      {status === "paused" ? "继续任务" : "暂停任务"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {panelEntries.map((entry) => {
                  const Icon = viewIcons[entry.target ?? ""] ?? IconPlus;
                  return (
                    <DropdownMenuItem key={entry.key} onClick={() => panelActions(entry)}>
                      <Icon size={15} />
                      {entry.label}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => wb.setSettings("general")}>
                  <IconSettings size={15} />
                  设置
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {views && (
        <nav className={`${css.tabs} dsh-conversation-views`} aria-label="会话视图">
          <button type="button" className={css.tab} data-active={!wb.state.open || undefined} onClick={wb.hide}>
            对话
          </button>
          {task && taskUI ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={css.tab}
                  data-active={(wb.state.open && activePanel?.kind === "task") || undefined}
                  aria-label="打开任务工具菜单"
                >
                  <IconTarget size={14} />
                  {wb.state.open && activePanel?.kind === "task"
                    ? (TASK_NAVIGATION.find((item) => item.id === activePanel.section)?.label ?? "任务工具")
                    : "任务工具"}
                  <IconChevronDown size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="dsh-task-tools-menu">
                <DropdownMenuGroup>
                  {TASK_NAVIGATION.map((item) => (
                    <DropdownMenuItem key={item.id} onClick={() => taskPanel(item.id)} className="dsh-task-menu-option">
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {wb.state.open && activePanel?.kind === "task" && activePanel.section === item.id && (
                        <IconCheck size={15} />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            panelEntries.map((entry) => {
              const Icon = viewIcons[entry.target ?? ""] ?? IconPlus;
              return (
                <button
                  type="button"
                  key={entry.key}
                  className={css.tab}
                  data-active={
                    (wb.state.open &&
                      (activePanel?.pluginId === entry.pluginId
                        ? activePanel?.contributionId === entry.target
                        : !activePanel?.pluginId && activePanel?.kind === entry.target)) ||
                    undefined
                  }
                  onClick={() => panelActions(entry)}
                >
                  <Icon size={14} />
                  {entry.label}
                </button>
              );
            })
          )}
        </nav>
      )}
    </header>
  );
}
