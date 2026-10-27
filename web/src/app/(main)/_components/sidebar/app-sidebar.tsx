"use client";
import * as React from "react";
import { PluginNavigation } from "@/components/plugins/contributions";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  IconAdjustments,
  IconClock,
  IconDots,
  IconKeyboard,
  IconLayoutDashboard,
  IconLogout,
  IconPlug,
} from "@tabler/icons-react";

import { IconNewChatOutlineRegular, IconPanelLeftOutlineRegular } from "@/components/dsh/upstream/primitives/icons";
import styles from "@/components/dsh/upstream/SidebarRoot.module.css";
import { ConversationSidebarSlot, useWorkbench } from "@/components/dsh/workbench-context";
import { ShrikeMark } from "@/components/shrike-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { APP_CONFIG } from "@/config/app-config";
import { useCurrentUser } from "@/hooks/use-current-user";
import { api } from "@/lib/api";
import { auth } from "@/lib/auth";
import type { Conversation } from "@/lib/types";
import { sidebarItems } from "@/navigation/sidebar/sidebar-items";

import { SearchDialog } from "./search-dialog";
export function AppSidebar() {
  const router=useRouter();
  React.useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(event.defaultPrevented||event.isComposing||!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=="n"||document.querySelector('[role="dialog"]'))return;event.preventDefault();router.push("/chat?new=1");};window.addEventListener("keydown",handle);return()=>window.removeEventListener("keydown",handle);},[router]);
  const { state, toggleSidebar, isMobile, openMobile, setOpenMobile } = useSidebar(),
    wb = useWorkbench();
  const collapsed = !isMobile && state === "collapsed",
    pathname = usePathname().replace(/\/+$/, ""),
    isChat = pathname === "/chat",
    user = useCurrentUser();
  const [recents, setRecents] = React.useState<Conversation[]>([]);
  React.useEffect(() => {
    if (isChat) return;
    let alive = true;
    api
      .conversations()
      .then((c) => {
        if (alive) setRecents(c.slice(0, 24));
      })
      .catch(() => {
        /* Full history remains in the chat route. */
      });
    return () => {
      alive = false;
    };
  }, [isChat]);
  const navigate = () => {
    if (isMobile) setOpenMobile(false);
  };
  const row = (href: string, label: string, Icon: React.ElementType) => (
    <Link
      prefetch={false}
      href={href}
      className={`${styles.panelRow} ${pathname === href ? styles.panelActive : ""}`}
      title={collapsed ? label : undefined}
      onClick={navigate}
    >
      <span className={styles.panelGlyph}>
        <Icon size={16} />
      </span>
      {!collapsed && <span className={styles.panelTitle}>{label}</span>}
    </Link>
  );
  const content = (
    <aside
      className={`${styles.root} ${collapsed ? styles.collapsed : ""} dsh-sidebar-native`}
      aria-label="主导航"
      data-collapsed={collapsed || undefined}
    >
      <div className={styles.logoRow}>
        {!collapsed && (
          <Link href="/chat?new=1" prefetch={false} className={styles.brand} onClick={navigate}>
            <span className={styles.brandIdentity}>
              <span className={styles.brandMark}>
                <ShrikeMark className="size-6" />
              </span>
              <span className={styles.brandName}>{APP_CONFIG.name}</span>
            </span>
          </Link>
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.toggle}`}
          aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          onClick={toggleSidebar}
        >
          <IconPanelLeftOutlineRegular size={16} />
        </button>
        <div hidden={collapsed}><SearchDialog/></div>
      </div>
      <Link prefetch={false} href="/chat?new=1" className={styles.newSession} aria-label="新建会话" onClick={navigate}>
        <span className={styles.newSessionLabelMask}>
          <span className={styles.newSessionContent}>
            <IconNewChatOutlineRegular size={16} />
            {!collapsed && <span className={styles.newSessionLabel}>新建会话</span>}
          </span>
        </span>
        {!collapsed && <span className={styles.newSessionShortcut}>⌘ N</span>}
      </Link>
      <nav className={styles.panelList} aria-label="工作区入口">
        {row("/system/extensions", "扩展", IconPlug)}
        {row("/system/automations", "自动化", IconClock)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.panelRow} aria-label="更多功能">
              <span className={styles.panelGlyph}>
                <IconLayoutDashboard size={16} />
              </span>
              {!collapsed && <span className={styles.panelTitle}>更多</span>}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? "right" : "bottom"}
            align="start"
            className="max-h-[70svh] w-60 overflow-y-auto"
          >
            {sidebarItems.map((group) => (
              <DropdownMenuGroup key={group.id ?? group.label}>
                <DropdownMenuLabel>{group.label || "功能"}</DropdownMenuLabel>
                {group.items.flatMap((item) => {
                  const targets = "subItems" in item && item.subItems?.length ? item.subItems : [item];
                  return targets.map((sub) =>
                    "url" in sub && sub.url ? (
                      <DropdownMenuItem key={sub.url} asChild>
                        <Link href={sub.url} prefetch={false} onClick={navigate}>
                          {sub.title}
                        </Link>
                      </DropdownMenuItem>
                    ) : null,
                  );
                })}
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <PluginNavigation/>
      <div className={styles.regionArea}>
        {isChat ? (
          <ConversationSidebarSlot />
        ) : collapsed ? (
          <Link className={styles.iconButton} href="/chat" title="会话">
            <IconNewChatOutlineRegular size={18} />
          </Link>
        ) : (
          <div className="dsh-native-recents">
            <p className="dsh-native-section-label">最近会话</p>
            {recents.map((c) => (
              <Link key={c.id} href={`/chat?c=${c.id}`} onClick={navigate} className="dsh-native-session">
                <span>{c.title || "新会话"}</span>
                {c.running && <span role="status" className="dsh-running-dot" aria-label="运行中" />}
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className={styles.footArea}>
        <button
          type="button"
          className={styles.panelRow}
          title="设置"
          onClick={() => {
            navigate();
            wb.setSettings("general");
          }}
        >
          <span className={styles.panelGlyph}>
            <IconAdjustments size={16} />
          </span>
          {!collapsed && <span className={styles.panelTitle}>设置</span>}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={`${styles.panelRow} dsh-native-account`} type="button" aria-label="账户与快捷键">
              <span className="dsh-avatar">{(user?.name ?? "S").slice(0, 1)}</span>
              {!collapsed && (
                <>
                  <span className={styles.panelTitle}>{user?.name ?? APP_CONFIG.name}</span>
                  <IconDots size={14} />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => wb.setShortcuts(true)}>
                <IconKeyboard size={15} />
                快捷键
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  auth.clearToken();
                  window.location.href = "/login";
                }}
              >
                <IconLogout size={15} />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
  return isMobile ? (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent side="left" className="dsh-mobile-navigation">
        <SheetTitle className="sr-only">主导航</SheetTitle>
        <SheetDescription className="sr-only">会话、工作区与设置</SheetDescription>
        {content}
      </SheetContent>
    </Sheet>
  ) : (
    content
  );
}
