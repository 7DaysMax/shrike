"use client";

import type * as React from "react";
import { useContributions } from "@/components/plugins/plugin-host";
import { PluginSettings } from "@/components/plugins/renderers";
import { PluginManager } from "@/components/plugins/plugin-manager";

import {
  IconAdjustments,
  IconBrain,
  IconRobot,
  IconPlug,
  IconSparkles,
  IconTool,
  IconShieldCheck,
  IconBell,
  IconKeyboard,
  IconX,
  IconClock,
} from "@tabler/icons-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useChatSendMode, setChatSendMode, CHAT_SEND_MODE_OPTIONS, type ChatSendMode } from "@/lib/chat-send-mode";
import { persistPreference } from "@/lib/preferences/preferences-storage";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { useWorkbench } from "./workbench-context";

const sections = [
  { id: "general", label: "通用", icon: IconAdjustments },
  { id: "models", label: "模型与账号", icon: IconBrain },
  { id: "agents", label: "Agent", icon: IconRobot },
  { id: "mcp", label: "MCP 服务", icon: IconPlug },
  { id: "skills", label: "技能", icon: IconSparkles },
  { id: "tools", label: "工具", icon: IconTool },
  { id: "permissions", label: "权限与审批", icon: IconShieldCheck },
  { id: "automations", label: "自动化任务", icon: IconClock },
  { id: "notifications", label: "通知", icon: IconBell },
  { id: "shortcuts", label: "快捷键", icon: IconKeyboard },
  { id: "system", label: "执行与系统", icon: IconAdjustments },
];
function GeneralSettings() {
  const wb = useWorkbench();
  const mode = useChatSendMode();
  const theme = usePreferencesStore((s) => s.themeMode);
  const setTheme = usePreferencesStore((s) => s.setThemeMode);
  return (
    <div className="dsh-preferences">
      <h2>通用</h2>
      <p>界面偏好保存在当前浏览器中。</p>
      <div className="dsh-preference-row">
        <label htmlFor="dsh-theme">外观</label>
        <select
          id="dsh-theme"
          value={theme}
          onChange={(e) => {
            const next = e.target.value as "light" | "dark" | "system";
            setTheme(next);
            void persistPreference("theme_mode", next);
          }}
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </div>
      <div className="dsh-preference-row">
        <label htmlFor="dsh-enter">发送消息</label>
        <select id="dsh-enter" value={mode} onChange={(e) => setChatSendMode(e.target.value as ChatSendMode)}>
          {CHAT_SEND_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="dsh-preference-row">
        <label htmlFor="dsh-process">过程详情</label>
        <select
          id="dsh-process"
          value={wb.transcriptMode}
          onChange={(e) => wb.setTranscriptMode(e.target.value as "compact" | "detailed")}
        >
          <option value="detailed">详细：显示工具与推理记录</option>
          <option value="compact">简洁：按需展开过程</option>
        </select>
      </div>
      <div className="dsh-preference-row">
        <span>布局</span>
        <button
          type="button"
          className="dsh-text-button"
          onClick={() => {
            wb.setSidebarWidth(280);
            wb.setPanelWidth(Math.round(window.innerWidth * 0.45));
          }}
        >
          恢复默认面板宽度
        </button>
      </div>
    </div>
  );
}
function ShortcutList() {
  return (
    <div className="dsh-shortcut-list">
      {[
        ["搜索页面", "⌘ / Ctrl K"],
        ["展开或折叠导航", "⌘ / Ctrl B"],
        ["设置", "⌘ / Ctrl ,"],
        ["文件面板", "⌘ / Ctrl Shift E"],
        ["终端", "⌘ / Ctrl `"],
        ["快捷键", "⌘ / Ctrl Shift ?"],
        ["发送消息", "按通用设置中的键位"],
        ["关闭对话框", "Esc"],
        ["调整面板宽度", "聚焦分隔线后按 ← / →"],
      ].map(([name, key]) => (
        <div key={name}>
          <span>{name}</span>
          <kbd>{key}</kbd>
        </div>
      ))}
    </div>
  );
}
export function WorkbenchSettings() {
  const { settings, setSettings } = useWorkbench();
  const contributed = useContributions("settings");
  const pluginSections = contributed.map((c) => ({
    id: c.renderer?.startsWith("builtin.") ? c.id : `plugin:${c.pluginId}:${c.id}`,
    label: c.label,
    icon: sections.find((s) => s.id === c.id)?.icon ?? IconPlug,
    entry: c,
  }));
  const visibleSections = [
    sections[0],
    { id: "plugins", label: "插件", icon: IconPlug },
    ...pluginSections,
    sections.find((s) => s.id === "shortcuts")!,
  ];
  const section = visibleSections.find((s) => s.id === settings) ?? visibleSections[0];
  const entry = pluginSections.find((s) => s.id === settings)?.entry;
  return (
    <Dialog
      open={settings !== null}
      onOpenChange={(open) => {
        if (!open) setSettings(null);
      }}
    >
      <DialogContent className="dsh-settings-dialog" showCloseButton={false}>
        <DialogTitle className="sr-only">设置 · {section.label}</DialogTitle>
        <DialogDescription className="sr-only">管理 ARTEX 的界面、模型、Agent 和执行配置</DialogDescription>
        <aside className="dsh-settings-nav">
          <strong>设置</strong>
          <nav aria-label="设置分类">
            {visibleSections.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                aria-label={label}
                data-active={settings === id}
                onClick={() => setSettings(id)}
              >
                <Icon size={17} stroke={1.7} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="dsh-settings-main">
          <header>
            <span>{section.label}</span>
            <button type="button" className="dsh-icon-btn" aria-label="关闭设置" onClick={() => setSettings(null)}>
              <IconX size={18} />
            </button>
          </header>
          <div className="dsh-settings-body" key={settings}>
            {settings === "plugins" ? (
              <PluginManager />
            ) : settings === "general" ? (
              <GeneralSettings />
            ) : settings === "shortcuts" ? (
              <ShortcutList />
            ) : entry ? (
              <PluginSettings entry={entry} />
            ) : (
              <p className="dsh-panel-message">此设置所属插件已停用。</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function WorkbenchShortcuts() {
  const { shortcuts, setShortcuts } = useWorkbench();
  return (
    <Dialog open={shortcuts} onOpenChange={setShortcuts}>
      <DialogContent>
        <DialogTitle>快捷键</DialogTitle>
        <DialogDescription>⌘ 对应 macOS，Ctrl 对应 Windows 和 Linux。</DialogDescription>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}
