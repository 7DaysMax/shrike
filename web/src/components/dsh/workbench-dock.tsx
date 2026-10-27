"use client";

import * as React from "react";
import { usePluginActions } from "@/components/plugins/contributions";
import { PluginPanel } from "@/components/plugins/renderers";
import { useContributions, contributionTab } from "@/components/plugins/plugin-host";

import {
  IconPlus,
  IconX,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconLayoutSidebarRightCollapse,
  IconFolders,
  IconBrowser,
  IconTerminal2,
  IconTarget,
  IconShieldCheck,
  IconLayoutSidebarRight,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { type WorkbenchTab } from "@/lib/dsh/workbench";

import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { ResizeHandle } from "./resize-handle";
import { useWorkbench } from "./workbench-context";

const panelIcons = {
  files: IconFolders,
  file: IconFolders,
  browser: IconBrowser,
  terminal: IconTerminal2,
  task: IconTarget,
  tasks: IconTarget,
  approvals: IconShieldCheck,
};
export function WorkbenchActions() {
  const panels = useContributions("panel"),
    run = usePluginActions();
  return (
    <div className="dsh-workbench-actions">
      {panels
        .filter((c) => !c.hidden)
        .map((c) => {
          const Icon = panelIcons[c.id as keyof typeof panelIcons] ?? IconTarget;
          return (
            <button
              type="button"
              className="dsh-icon-btn"
              aria-label={`打开${c.label}面板`}
              title={c.label}
              key={c.key}
              onClick={() => run({ ...c, target: c.id })}
            >
              <Icon size={17} />
            </button>
          );
        })}
    </div>
  );
}
function PanelContent({ tab, active }: { tab: WorkbenchTab; active: boolean }) {
  return <PluginPanel tab={tab} active={active} />;
}
export function WorkbenchDock({ overlay, width, maxWidth }: { overlay: boolean; width: number; maxWidth: number }) {
  const wb = useWorkbench();
  const pluginPanels = useContributions("panel").filter((c) => !c.hidden);
  const [closing, setClosing] = React.useState<string | null>(null);
  const dockRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    if (!overlay || !wb.state.open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dockRef.current;
    root?.focus();
    function key(e: KeyboardEvent) {
      if (document.querySelector('[data-slot="dialog-content"], [data-slot="dropdown-menu-content"]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        wb.hide();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (!focusable.length) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey && (document.activeElement === focusable[0] || document.activeElement === root)) {
        e.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!e.shiftKey && (document.activeElement === focusable.at(-1) || document.activeElement === root)) {
        e.preventDefault();
        focusable[0].focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [overlay, wb.state.open, wb.hide]);
  async function close(id: string) {
    const tab = wb.state.tabs.find((t) => t.id === id);
    if (tab?.kind === "terminal" || wb.dirtyTabs[id]) {
      setClosing(id);
      return;
    }
    wb.closeTab(id);
  }
  const content = (
    <>
      <header className="dsh-dock-header">
        <div className="dsh-dock-tabs" role="tablist" aria-label="工作台标签">
          {wb.state.tabs.map((tab) => {
            const Icon = panelIcons[tab.kind as keyof typeof panelIcons] ?? IconTarget;
            return (
              <div className="dsh-dock-tab" key={tab.id} data-active={wb.state.active === tab.id}>
                <button
                  type="button"
                  role="tab"
                  id={`tab-${tab.id}`}
                  aria-controls={`panel-${tab.id}`}
                  aria-selected={wb.state.active === tab.id}
                  onClick={() => wb.selectTab(tab.id)}
                >
                  <Icon size={15} />
                  <span>{tab.title}</span>
                </button>
                <button
                  type="button"
                  className="dsh-tab-close"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={() => void close(tab.id)}
                >
                  <IconX size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="dsh-icon-btn" aria-label="新建面板">
              <IconPlus size={17} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {pluginPanels.map((entry) => (
                <DropdownMenuItem
                  key={entry.key}
                  onClick={() =>
                    entry.renderer?.startsWith("builtin.")
                      ? wb.openPanel(entry.id as "files" | "browser" | "terminal" | "tasks" | "approvals")
                      : wb.openTab(contributionTab(entry))
                  }
                >
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="dsh-icon-btn"
          aria-label={wb.state.fullscreen ? "退出全屏" : "全屏面板"}
          onClick={wb.toggleFullscreen}
        >
          {wb.state.fullscreen ? <IconArrowsMinimize size={16} /> : <IconArrowsMaximize size={16} />}
        </button>
        <button type="button" className="dsh-icon-btn" aria-label="收起工作台" onClick={wb.hide}>
          <IconLayoutSidebarRightCollapse size={17} />
        </button>
      </header>
      <div className="dsh-dock-body">
        {wb.state.tabs.map((tab) => (
          <section
            key={tab.id}
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            hidden={wb.state.active !== tab.id}
            className="dsh-dock-content"
          >
            <PanelContent tab={tab} active={wb.state.active === tab.id && wb.state.open} />
          </section>
        ))}
      </div>
    </>
  );
  const closingTab = wb.state.tabs.find((t) => t.id === closing);
  const terminalClosing = closingTab?.kind === "terminal";
  return (
    <>
      <dialog
        open={wb.state.open}
        ref={dockRef}
        tabIndex={-1}
        className="dsh-dock"
        data-open={wb.state.open}
        data-overlay={(overlay && wb.state.open) || undefined}
        aria-modal={overlay && wb.state.open ? true : undefined}
        aria-label="右侧工作台"
      >
        {wb.state.open && !overlay && (
          <ResizeHandle
            label="调整工作台宽度"
            side="right"
            value={width}
            min={300}
            max={Math.max(300, maxWidth)}
            onChange={wb.setPanelWidth}
          />
        )}
        {content}
      </dialog>
      <Dialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{terminalClosing ? "关闭终端？" : "放弃未保存的修改？"}</DialogTitle>
          <DialogDescription>
            {terminalClosing
              ? "关闭标签会结束这个终端的进程。收起工作台则保留进程。"
              : "文件存在未保存的修改。取消可返回编辑，关闭会放弃这些修改。"}
          </DialogDescription>
          <div className="dsh-dialog-actions">
            <button type="button" onClick={() => setClosing(null)}>
              取消
            </button>
            <button
              type="button"
              className="dsh-danger-button"
              onClick={async () => {
                if (!closing) return;
                try {
                  if (terminalClosing) await api.uiTerminalClose(closing);
                  wb.closeTab(closing);
                  setClosing(null);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {terminalClosing ? "结束进程并关闭" : "放弃修改并关闭"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
