import { IconBan, IconRobot, IconBrain, type Icon, IconAdjustments, IconShieldExclamation, IconTerminal2, IconActivity as Activity, IconBug as Bug, IconClipboardList as ClipboardList, IconFolderOpen as FolderOpen, IconLayoutDashboard as LayoutDashboard, IconMessage as MessageSquare, IconNetwork as Network, IconPlug as Plug, IconSparkles as Sparkles, IconTarget as Target, IconTool as Wrench, IconBellRinging as BellRing, IconFolderSymlink as FolderSync, IconRadio as Radio, IconFileText as ScrollText } from "@tabler/icons-react";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: Icon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: Icon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "功能",
    items: [
      { id: "dashboard", title: "仪表盘", url: "/dashboard", icon: LayoutDashboard },
      { id: "chat", title: "对话", url: "/chat", icon: MessageSquare },
      { id: "tasks", title: "任务", url: "/function/tasks", icon: Target },
      { id: "findings", title: "发现", url: "/function/findings", icon: Bug },
      { id: "traffic", title: "流量", url: "/function/traffic", icon: Activity },
      { id: "commands", title: "工具执行", url: "/function/commands", icon: IconTerminal2 },
      { id: "llm-records", title: "LLM 录制", url: "/function/llm-records", icon: Radio },
      { id: "assets", title: "资产", url: "/function/assets", icon: Network },
      { id: "sync", title: "资产同步", url: "/function/sync", icon: FolderSync },
      { id: "workspace", title: "工作空间", url: "/function/workspace", icon: FolderOpen },
    ],
  },
  {
    id: 2,
    label: "系统",
    items: [
      { id: "llm", title: "LLM", url: "/system/llm", icon: IconBrain },
      { id: "agents", title: "Agent", url: "/system/agents", icon: IconRobot },
      { id: "mcp", title: "MCP", url: "/system/mcp", icon: Plug },
      { id: "skills", title: "Skill", url: "/system/skills", icon: Sparkles },
      { id: "tools", title: "工具", url: "/system/tools", icon: Wrench },
      { id: "notify", title: "通知推送", url: "/system/notify", icon: BellRing },
      { id: "intercept", title: "拦截规则", url: "/system/intercept", icon: IconShieldExclamation },
      { id: "asset-intercept", title: "资产拦截", url: "/system/intercept/assets", icon: IconBan },
      { id: "approvals", title: "审批记录", url: "/system/intercept/approvals", icon: ClipboardList },
      { id: "logs", title: "日志", url: "/system/logs", icon: ScrollText },
      { id: "extensions", title: "扩展", url: "/system/extensions", icon: Plug },
      { id: "automations", title: "自动化任务", url: "/system/automations", icon: ClipboardList },
      { id: "settings", title: "系统配置", url: "/system/settings", icon: IconAdjustments },
    ],
  },
];
