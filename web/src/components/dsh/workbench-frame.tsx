"use client";

import * as React from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { panelGeometry } from "@/lib/dsh/workbench";
import { AppSidebar } from "@/app/(main)/_components/sidebar/app-sidebar";
import { MainContent } from "@/app/(main)/_components/main-content";
import { ResizeHandle } from "./resize-handle";
import { WorkbenchDock } from "./workbench-dock";
import { WorkbenchSettings, WorkbenchShortcuts } from "./workbench-settings";
import { useWorkbench } from "./workbench-context";

export function WorkbenchFrame({ children }: { children: React.ReactNode }) {
  const { state: sidebarState, setOpen, isMobile } = useSidebar();
  const wb = useWorkbench();
  const [viewport, setViewport] = React.useState(1440);
  React.useEffect(() => {
    const update = () => {
      setViewport(window.innerWidth);
      if (window.innerWidth < 1024) setOpen(false);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [setOpen]);
  React.useEffect(() => {
    if (wb.state.open && window.innerWidth < 1280) setOpen(false);
  }, [wb.state.open, setOpen]);
  const collapsed = sidebarState === "collapsed";
  const geometry = panelGeometry(viewport, isMobile ? 0 : collapsed ? 56 : wb.sidebarWidth, wb.panelWidth);
  return (
    <div
      className="dsh-frame dsh-workbench"
      data-dsh-ui="workbench"
      data-collapsed={collapsed ? "true" : undefined}
      data-panel-open={wb.state.open && !geometry.overlay && !wb.state.fullscreen ? "true" : undefined}
      data-transcript={wb.transcriptMode}
      style={
        {
          "--dsh-sidebar-width": `${isMobile ? 0 : collapsed ? 56 : wb.sidebarWidth}px`,
          "--dsh-panel-width": `${geometry.width}px`,
        } as React.CSSProperties
      }
    >
      <div className="dsh-sidebar-column" inert={wb.state.open && (geometry.overlay || wb.state.fullscreen)}>
        <AppSidebar />
        {!collapsed && (
          <ResizeHandle
            label="调整侧栏宽度"
            value={wb.sidebarWidth}
            min={264}
            max={420}
            onChange={wb.setSidebarWidth}
          />
        )}
      </div>
      <div className="dsh-center" inert={wb.state.open && (geometry.overlay || wb.state.fullscreen)}>
        <MainContent>{children}</MainContent>
      </div>
      <WorkbenchDock
        overlay={geometry.overlay || wb.state.fullscreen}
        width={geometry.width}
        maxWidth={Math.min(viewport * 0.7, viewport - (collapsed ? 56 : wb.sidebarWidth) - 400)}
      />
      <WorkbenchSettings />
      <WorkbenchShortcuts />
    </div>
  );
}
