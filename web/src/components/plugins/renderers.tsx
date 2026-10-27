"use client";
import dynamic from "next/dynamic";
import type { WorkbenchTab } from "@/lib/dsh/workbench";
import type { OwnedContribution } from "@/lib/plugins/kernel";
import { PluginFrame } from "./plugin-frame";
import { PluginBoundary, useContributions, findPanel } from "./plugin-host";
const loading = () => (
  <p className="dsh-panel-message" role="status">
    正在加载插件…
  </p>
);
interface Props {
  tab: WorkbenchTab;
  active: boolean;
}
const panels: Record<string, React.ComponentType<Props>> = {
  "builtin.files": dynamic(
    () =>
      import("@/components/dsh/workbench-files").then(
        (m) =>
          function Files() {
            return <m.FilesPanel />;
          },
      ),
    { loading },
  ),
  "builtin.file": dynamic(
    () =>
      import("@/components/dsh/workbench-files").then(
        (m) =>
          function File({ tab }: Props) {
            return <m.FilePanel path={tab.path ?? ""} />;
          },
      ),
    { loading },
  ),
  "builtin.terminal": dynamic(
    () =>
      import("@/components/dsh/workbench-terminal").then(
        (m) =>
          function Terminal({ tab, active }: Props) {
            return <m.TerminalPanel id={tab.id} active={active} />;
          },
      ),
    { loading },
  ),
  "builtin.browser": dynamic(
    () =>
      import("@/components/dsh/workbench-panels").then(
        (m) =>
          function Browser({ tab }: Props) {
            return <m.BrowserPanel tab={tab} />;
          },
      ),
    { loading },
  ),
  "builtin.tasks": dynamic(
    () =>
      import("@/components/dsh/workbench-panels").then(
        (m) =>
          function Tasks() {
            return <m.TasksPanel />;
          },
      ),
    { loading },
  ),
  "builtin.approvals": dynamic(
    () =>
      import("@/components/dsh/workbench-panels").then(
        (m) =>
          function Approvals() {
            return <m.ApprovalsPanel />;
          },
      ),
    { loading },
  ),
  "builtin.task": dynamic(
    () =>
      import("@/components/dsh/task-inspector").then(
        (m) =>
          function Task({ tab }: Props) {
            return (
              <m.TaskInspector
                taskId={tab.taskId ?? ""}
                section={tab.section as import("@/components/dsh/task-inspector").TaskSection}
              />
            );
          },
      ),
    { loading },
  ),
};
const settings: Record<string, React.ComponentType> = {
  "builtin.models": dynamic(() => import("@/app/(main)/system/llm/page"), { loading }),
  "builtin.agents": dynamic(() => import("@/app/(main)/system/agents/page"), { loading }),
  "builtin.mcp": dynamic(() => import("@/app/(main)/system/mcp/page"), { loading }),
  "builtin.skills": dynamic(() => import("@/app/(main)/system/skills/page"), { loading }),
  "builtin.tools": dynamic(() => import("@/app/(main)/system/tools/page"), { loading }),
  "builtin.permissions": dynamic(() => import("@/app/(main)/system/intercept/page"), { loading }),
  "builtin.notifications": dynamic(() => import("@/app/(main)/system/notify/page"), { loading }),
  "builtin.system": dynamic(() => import("@/app/(main)/system/settings/page"), { loading }),
  "builtin.automations": dynamic(() => import("@/app/(main)/system/automations/page"), { loading }),
};
export function PluginPanel({ tab, active }: Props) {
  const entries = useContributions("panel"),
    entry = findPanel(entries, tab.kind, tab.pluginId, tab.contributionId);
  if (!entry)
    return (
      <div className="dsh-panel-message">
        此面板所属插件已停用，启用后可恢复。<a href="/system/extensions">插件管理</a>
      </div>
    );
  const Panel = panels[entry.renderer ?? ""];
  return (
    <PluginBoundary key={entry.key} pluginId={entry.pluginId}>
      {Panel ? (
        <Panel tab={tab} active={active} />
      ) : (
        <PluginFrame pluginId={entry.pluginId} entry={entry.renderer ?? ""} context={{ tab }} />
      )}
    </PluginBoundary>
  );
}
export function PluginSettings({ entry }: { entry: OwnedContribution }) {
  const Page = settings[entry.renderer ?? ""];
  return (
    <PluginBoundary key={entry.key} pluginId={entry.pluginId}>
      {Page ? <Page /> : <PluginFrame pluginId={entry.pluginId} entry={entry.renderer ?? ""} />}
    </PluginBoundary>
  );
}
