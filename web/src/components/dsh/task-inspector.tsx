"use client";

import * as React from "react";

import dynamic from "next/dynamic";
import { IconChevronDown } from "@tabler/icons-react";
import { TASK_NAVIGATION } from "@/lib/dsh/task-navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkbench } from "./workbench-context";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const loading = () => (
  <p className="dsh-panel-message" role="status">
    正在加载任务面板…
  </p>
);
const Overview = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/overview-tab").then((m) => m.OverviewTab),
  { loading },
);
const Sessions = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/sessions-tab").then((m) => m.SessionsTab),
  { loading },
);
const Graph = dynamic(() => import("@/app/(main)/function/tasks/detail/_tabs/graph-tab").then((m) => m.GraphTab), {
  loading,
});
const Findings = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/findings-tab").then((m) => m.FindingsTab),
  { loading },
);
const Assets = dynamic(() => import("@/app/(main)/function/tasks/detail/_tabs/assets-tab").then((m) => m.AssetsTab), {
  loading,
});
const Report = dynamic(() => import("@/app/(main)/function/tasks/detail/_tabs/report-tab").then((m) => m.ReportTab), {
  loading,
});
const Retests = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/retests-tab").then((m) => m.RetestsTab),
  { loading },
);
const Broadcast = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/broadcast-tab").then((m) => m.BroadcastTab),
  { loading },
);
const Coverage = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/coverage-graph-tab").then((m) => m.CoverageGraphTab),
  { loading },
);
const Intercept = dynamic(
  () => import("@/app/(main)/function/tasks/detail/_tabs/intercept-tab").then((m) => m.InterceptTab),
  { loading },
);
const PANELS = {
  overview: ["总览", Overview],
  sessions: ["执行会话", Sessions],
  graph: ["探索链路", Graph],
  findings: ["发现", Findings],
  assets: ["资产", Assets],
  coverage: ["覆盖图", Coverage],
  intercept: ["审批", Intercept],
  report: ["报告", Report],
  retests: ["复测", Retests],
  broadcast: ["播报", Broadcast],
} as const;
export type TaskSection = keyof typeof PANELS;
export function TaskInspector({ taskId, section = "overview" }: { taskId: string; section?: TaskSection }) {
  const wb = useWorkbench();
  const [current, setCurrent] = React.useState<TaskSection>(section);
  React.useEffect(() => setCurrent(section), [section]);
  const [coverageEnabled, setCoverageEnabled] = React.useState(true);
  React.useEffect(() => {
    let active = true;
    api
      .task(taskId)
      .then((t) => {
        if (active) setCoverageEnabled(t.coverage_enabled !== false);
      })
      .catch(() => {
        /* The selected panel owns its API error UI. */
      });
    return () => {
      active = false;
    };
  }, [taskId]);
  const Panel = PANELS[current][1];
  return (
    <div className="dsh-task-inspector">
      <nav aria-label="任务详情" className="border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              {PANELS[current][0]}
              <IconChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="dsh-task-tools-menu">
            <DropdownMenuGroup>
              {TASK_NAVIGATION.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="dsh-task-menu-option"
                  onClick={() =>
                    wb.openTab({
                      id: `task:${taskId}:${item.id}`,
                      kind: "task",
                      taskId,
                      section: item.id,
                      title: `任务 #${taskId} · ${item.label}`,
                    })
                  }
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {current === "sessions" ? (
          <Sessions key={taskId} taskId={taskId} readOnly />
        ) : current === "coverage" ? (
          <Coverage taskId={taskId} coverageEnabled={coverageEnabled} />
        ) : (
          <Panel key={`${taskId}:${current}`} taskId={taskId} />
        )}
      </div>
    </div>
  );
}
