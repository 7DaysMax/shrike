"use client";

import { type ReactNode, useMemo } from "react";

import { usePathname } from "next/navigation";
import { IconLayoutSidebar } from "@tabler/icons-react";
import { useSidebar } from "@/components/ui/sidebar";
import { ConversationHeader } from "@/components/dsh/conversation-header";

import { useCurrentUser } from "@/hooks/use-current-user";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

import { AccountSwitcher } from "./sidebar/account-switcher";
import { LayoutControls } from "./sidebar/layout-controls";
import { SearchDialog } from "./sidebar/search-dialog";
import { ThemeSwitcher } from "./sidebar/theme-switcher";
import { UpdateBadge } from "./update-badge";

// 任务详情页保持原样：它自带头部/Tabs 与内边距，这里不再叠加全局头部和 padding。
function isFullBleed(pathname: string) {
  const p = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  // 静态导出开了 trailingSlash，列表页自身的 pathname 是 "/function/tasks/"，
  // 先去掉尾斜杠再判前缀，否则列表页会被误判成详情页而丢掉全局头部。
  const normalized = p.replace(/\/+$/, "");
  return normalized.startsWith("/function/tasks/");
}

/**
 * Centre column. dsh keeps one slim title row here — no breadcrumb trail, no
 * separator, no page-meta badges — and lets the page own its own surface.
 */
export function MainContent({ children }: { children: ReactNode }) {
  const currentUser = useCurrentUser();
  const { toggleSidebar, isMobile } = useSidebar();
  const pathname = usePathname();

  const crumb = useMemo(() => {
    const p = pathname.replace(/\/+$/, "");
    for (const group of sidebarItems) {
      for (const item of group.items) {
        if ("subItems" in item && item.subItems?.length) {
          for (const sub of item.subItems) {
            if (p.startsWith(sub.url.replace(/\/+$/, ""))) {
              return { group: group.label ?? "", title: sub.title };
            }
          }
          continue;
        }
        if ("url" in item && p.startsWith(item.url.replace(/\/+$/, ""))) {
          return { group: group.label ?? "", title: item.title };
        }
      }
    }
    return { group: "", title: "" };
  }, [pathname]);

  if (isFullBleed(pathname) || pathname.replace(/\/+$/, "")==="/chat") {
    return <>{children}</>;
  }

  return (
    <>
      <ConversationHeader title={crumb.title||"SHRIKE"} views={false}/>
      <div className="dsh-content" data-bleed={pathname.includes("/chat") ? "true" : undefined}>
        {children}
      </div>
    </>
  );
}
