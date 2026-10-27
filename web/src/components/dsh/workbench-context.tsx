"use client";

import * as React from "react";
import { INITIAL_WORKBENCH, restoreWorkbench, workbenchReducer, type WorkbenchTab } from "@/lib/dsh/workbench";

interface WorkbenchContextValue {
  state: typeof INITIAL_WORKBENCH;
  dirtyTabs: Record<string, boolean>;
  setTabDirty: (id: string, dirty: boolean) => void;
  openTab: (tab: WorkbenchTab) => void;
  openPanel: (kind: "files" | "browser" | "terminal" | "tasks" | "approvals") => void;
  openFile: (path: string) => void;
  selectTab: (id: string) => void;
  closeTab: (id: string) => void;
  hide: () => void;
  toggleFullscreen: () => void;
  settings: string | null;
  setSettings: (section: string | null) => void;
  shortcuts: boolean;
  setShortcuts: (open: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  panelWidth: number | undefined;
  setPanelWidth: (width: number) => void;
  transcriptMode: "compact" | "detailed";
  setTranscriptMode: (mode: "compact" | "detailed") => void;
}
const Context = React.createContext<WorkbenchContextValue | null>(null);
const SidebarContent = React.createContext<React.ReactNode>(null);
const SidebarContentSetter = React.createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);
const labels = {
  files: "文件",
  browser: "浏览器",
  terminal: "终端",
  tasks: "任务与目标",
  approvals: "待审批",
};
export function WorkbenchProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(workbenchReducer, INITIAL_WORKBENCH);
  const [ready, setReady] = React.useState(false);
  const [dirtyTabs, setDirtyTabs] = React.useState<Record<string, boolean>>({});
  const setTabDirty = React.useCallback(
    (id: string, dirty: boolean) =>
      setDirtyTabs((current) => (current[id] === dirty ? current : { ...current, [id]: dirty })),
    [],
  );
  const [settings, setSettings] = React.useState<string | null>(null);
  const [shortcuts, setShortcuts] = React.useState(false);
  const [sidebarContent, setSidebarContent] = React.useState<React.ReactNode>(null);
  const [sidebarWidth, setSidebarWidth] = React.useState(280);
  const [panelWidth, setPanelWidth] = React.useState<number>();
  const [transcriptMode, setTranscriptMode] = React.useState<"compact" | "detailed">("detailed");
  React.useEffect(() => {
    try {
      dispatch({ type: "restore", state: restoreWorkbench(localStorage.getItem("artex.dsh.workbench.v1")) });
      const widths = JSON.parse(localStorage.getItem("artex.dsh.geometry.v1") ?? "{}");
      if (Number.isFinite(widths.sidebar)) setSidebarWidth(Math.max(264, Math.min(420, widths.sidebar)));
      if (Number.isFinite(widths.panel)) setPanelWidth(Math.max(300, widths.panel));
      if (localStorage.getItem("artex.dsh.transcript") === "compact") setTranscriptMode("compact");
    } catch {
      /* Storage is optional; the current in-memory UI remains usable. */
    }
    setReady(true);
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem("artex.dsh.workbench.v1", JSON.stringify(state));
      localStorage.setItem("artex.dsh.geometry.v1", JSON.stringify({ sidebar: sidebarWidth, panel: panelWidth }));
      localStorage.setItem("artex.dsh.transcript", transcriptMode);
    } catch {
      /* Full or blocked storage must not block navigation or execution. */
    }
  }, [state, sidebarWidth, panelWidth, transcriptMode, ready]);
  const openTab = React.useCallback((tab: WorkbenchTab) => dispatch({ type: "open", tab }), []);
  const openPanel = React.useCallback(
    (kind: keyof typeof labels) => {
      const multiple = kind === "browser" || kind === "terminal";
      openTab({ id: multiple ? `${kind}:${crypto.randomUUID()}` : kind, kind, title: labels[kind] });
    },
    [openTab],
  );
  const openFile = React.useCallback(
    (path: string) => openTab({ id: `file:${path}`, kind: "file", title: path.split("/").pop() || path, path }),
    [openTab],
  );
  React.useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (document.querySelector('[data-slot="dialog-content"], [data-slot="sheet-content"]')) return;
      if (e.key === ",") {
        e.preventDefault();
        setSettings("general");
      }
      if (e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        openPanel("files");
      }
      if (e.key === "`") {
        e.preventDefault();
        const existing = state.tabs.find((t) => t.kind === "terminal");
        existing ? dispatch({ type: "select", id: existing.id }) : openPanel("terminal");
      }
      if (e.shiftKey && e.key === "?") {
        e.preventDefault();
        setShortcuts(true);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [openPanel, state.tabs]);
  const selectTab = React.useCallback((id: string) => dispatch({ type: "select", id }), []);
  const closeTab = React.useCallback((id: string) => dispatch({ type: "close", id }), []);
  const hide = React.useCallback(() => dispatch({ type: "hide" }), []);
  const toggleFullscreen = React.useCallback(() => dispatch({ type: "fullscreen" }), []);
  const value = React.useMemo(
    () => ({
      state,
      dirtyTabs,
      setTabDirty,
      openTab,
      openPanel,
      openFile,
      selectTab,
      closeTab,
      hide,
      toggleFullscreen,
      settings,
      setSettings,
      shortcuts,
      setShortcuts,
      sidebarWidth,
      setSidebarWidth,
      panelWidth,
      setPanelWidth,
      transcriptMode,
      setTranscriptMode,
    }),
    [
      state,
      dirtyTabs,
      setTabDirty,
      openTab,
      openPanel,
      openFile,
      selectTab,
      closeTab,
      hide,
      toggleFullscreen,
      settings,
      shortcuts,
      sidebarWidth,
      panelWidth,
      transcriptMode,
    ],
  );
  return (
    <SidebarContentSetter.Provider value={setSidebarContent}>
      <SidebarContent.Provider value={sidebarContent}>
        <Context.Provider value={value}>{children}</Context.Provider>
      </SidebarContent.Provider>
    </SidebarContentSetter.Provider>
  );
}
export function useWorkbench() {
  const context = React.useContext(Context);
  if (!context) throw new Error("WorkbenchProvider is required");
  return context;
}
/** Keep the sidebar DOM owned by its sidebar, including across mobile Sheet mounts. */
export function ConversationSidebar({ children }: { children: React.ReactNode }) {
  const setContent = React.useContext(SidebarContentSetter);
  React.useLayoutEffect(() => {
    setContent?.(children);
    return () => setContent?.(null);
  }, [children, setContent]);
  return null;
}
export function ConversationSidebarSlot() {
  const content = React.useContext(SidebarContent);
  return <div className="dsh-conversations">{content}</div>;
}
