"use client";
import * as React from "react";
import { IconPlug } from "@tabler/icons-react";
import { useWorkbench } from "@/components/dsh/workbench-context";
import { useContributions, contributionTab } from "./plugin-host";
import { PluginFrame } from "./plugin-frame";
import type { Activity } from "@/lib/types";
import type { OwnedContribution } from "@/lib/plugins/kernel";
export function usePluginActions() {
  const wb = useWorkbench(),
    panels = useContributions("panel");
  return React.useCallback(
    (entry: OwnedContribution) => {
      if(entry.pluginId==="artex.core"&&entry.target?.startsWith("host.inference.")){
      let parent=document.activeElement?.parentElement;let control:Element|null=null;
      while(parent&&!control){control=parent.querySelector("[data-inference-control]");parent=parent.parentElement}
      control?.dispatchEvent(new CustomEvent("artex:inference-open",{detail:entry.target.slice(15)}));return;
    }
    if (entry.pluginId === "artex.core" && entry.target?.startsWith("host.settings.")) {
        wb.setSettings(entry.target.slice(14));
        return;
      }
      const panel = panels.find((p) => p.pluginId === entry.pluginId && p.id === entry.target);
      if (!panel) throw new Error(`插件目标未挂载：${entry.target}`);
      if (panel.renderer?.startsWith("builtin.")) {
        wb.openPanel(panel.id as "files" | "browser" | "terminal" | "tasks" | "approvals");
      } else {
        wb.openTab(contributionTab(panel));
      }
    },
    [wb, panels],
  );
}
export function PluginNavigation() {
  const entries = useContributions("navigation"),
    run = usePluginActions();
  return (
    <>
      {entries.map((c) => (
        <button key={c.key} className="dsh-row" type="button" onClick={() => run(c)}>
          <IconPlug size={16} />
          <span className="dsh-row-title">{c.label}</span>
        </button>
      ))}
    </>
  );
}
export function PluginMessage({
  activity,
  fetchDetail,
  fallback,
}: {
  activity: Activity;
  fetchDetail: (seq: number) => Promise<string>;
  fallback: React.ReactNode;
}) {
  const entries = useContributions("message"),
    entry = entries.find((c) => c.when === activity.kind);
  const [detail, setDetail] = React.useState<{ seq: number; value: string }>();
  React.useEffect(() => {
    if (!entry || activity.detail || activity.seq <= 0) return;
    let alive = true;
    fetchDetail(activity.seq)
      .then((d) => {
        if (alive) setDetail({ seq: activity.seq, value: d });
      })
      .catch(() => {
        /* Existing summary stays visible to the plugin. */
      });
    return () => {
      alive = false;
    };
  }, [entry, activity.seq, activity.detail, fetchDetail]);
  if (!entry?.renderer) return fallback;
  return (
    <div className="dsh-plugin-message">
      <PluginFrame
        key={entry.key}
        pluginId={entry.pluginId}
        entry={entry.renderer}
        context={{
          activity: {
            ...activity,
            detail: activity.detail ?? (detail?.seq === activity.seq ? detail.value : undefined),
          },
        }}
      />
      <details>
        <summary>查看原始消息</summary>
        {fallback}
      </details>
    </div>
  );
}
