"use client";
import * as React from "react";
import {useContributions}from"@/components/plugins/plugin-host";
import{usePluginActions}from"@/components/plugins/contributions";

import {
  IconArrowUp,
  IconLoader2,
  IconPlus,
  IconSquare,
  IconX,
  IconPaperclip as PaperclipIcon,
} from "@tabler/icons-react";

import { useWorkbench } from "@/components/dsh/workbench-context";
import { MentionTextarea } from "@/components/mention-textarea";
import { shouldSubmitOnKey, useChatSendMode } from "@/lib/chat-send-mode";
import { isBtwCommand } from "@/lib/side-questions";
import type { ChatAttachment } from "@/lib/types";
import composer from "@/styles/dsh/upstream/InputBar.module.css";
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  leftSlot,
  running,
  onStop,
  stopDisabled,
  attachments,
  onPickFiles,
  onRemoveAttachment,
  uploading,
  allowBtw,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  leftSlot?: React.ReactNode;
  running?: boolean;
  onStop?: () => void;
  stopDisabled?: boolean;
  // 方式1 文件上传:传了 onPickFiles 才显示回形针按钮 + 附件 chip 预览。
  attachments?: ChatAttachment[];
  onPickFiles?: (files: File[]) => void;
  onRemoveAttachment?: (path: string) => void;
  uploading?: boolean;
  allowBtw?: boolean;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const wb = useWorkbench();
  const [dragging, setDragging] = React.useState(false);
  const pluginCommands=useContributions("command"),runPlugin=usePluginActions();
  const commands=pluginCommands.map(entry=>({key:entry.command??"",title:entry.label,run:()=>runPlugin(entry)}));
  const suggestions = /^\/[a-z]*$/.test(value) ? commands.filter((c) => c.key.startsWith(value)) : [];
  function submit() {
    const command = commands.find((c) => c.key === value.trim());
    if (command) {
      command.run();
      onChange("");
      return;
    }
    onSend();
  }
  const atts = attachments ?? [];
  // 发送键位由系统设置决定（localStorage），默认 Enter 发送。
  const sendMode = useChatSendMode();
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSubmitOnKey(e, sendMode)) return;
    e.preventDefault();
    submit();
  }
  return (
    <fieldset
      aria-label="消息编辑器"
      className={`${composer.root} dsh-composer`}
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        if (onPickFiles && !disabled && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (onPickFiles && !disabled && e.dataTransfer.files.length) onPickFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className={composer.card}>
        {suggestions.length > 0 && (
          <div className="dsh-command-menu" role="listbox" aria-label="界面命令">
            {suggestions.map((c) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={c.key}
                onClick={() => {
                  c.run();
                  onChange("");
                }}
              >
                <code>{c.key}</code>
                <span>{c.title}</span>
              </button>
            ))}
          </div>
        )}
        {atts.length > 0 && (
          <div className="dsh-composer-attachments">
            {atts.map((a) => (
              <div className="dsh-attachment-chip" key={a.path} title={a.path}>
                <PaperclipIcon size={15} />
                <span>{a.name}</span>
                <small>{fmtBytes(a.size)}</small>
                {onRemoveAttachment && (
                  <button
                    type="button"
                    className="dsh-icon-btn"
                    aria-label={`移除 ${a.name}`}
                    onClick={() => onRemoveAttachment(a.path)}
                  >
                    <IconX size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <MentionTextarea
          className="dsh-composer-input"
          rows={2}
          aria-label="消息"
          placeholder={placeholder}
          value={value}
          disabled={disabled && !(running && allowBtw)}
          onValueChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && onPickFiles && !disabled) {
              e.preventDefault();
              onPickFiles(files);
            }
          }}
        />
        <div className={composer.row}>
          <div className={composer.tools}>
            {onPickFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (files.length) onPickFiles(files);
                  }}
                />
                <button
                  type="button"
                  className={composer.add}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || uploading}
                  aria-label="上传附件"
                  title="上传附件"
                >
                  {uploading ? <IconLoader2 size={18} className="animate-spin" /> : <IconPlus size={20} stroke={1.7} />}
                </button>
              </>
            )}
            {leftSlot}
          </div>
          <div className={composer.trailing}>
            {running && !isBtwCommand(value) && (value.trim() || atts.length > 0) && (
              <button
                type="button"
                className={composer.primary}
                onClick={onSend}
                aria-label="加入发送队列"
                title="当前运行结束后发送"
              >
                <IconArrowUp size={18} />
              </button>
            )}
            {running && allowBtw && isBtwCommand(value) && (
              <button type="button" className={composer.primary} onClick={onSend} aria-label="发送旁路问题">
                <IconArrowUp size={18} />
              </button>
            )}
            {running ? (
              <button
                type="button"
                className={composer.primary}
                onClick={onStop}
                disabled={stopDisabled}
                aria-label="停止本次运行"
              >
                <IconSquare size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className={composer.primary}
                onClick={submit}
                disabled={disabled || (!value.trim() && atts.length === 0)}
                aria-label="发送消息"
              >
                <IconArrowUp size={19} />
              </button>
            )}
          </div>
        </div>
      </div>
      {dragging && <div className="dsh-drop-hint">松开以上传附件</div>}
    </fieldset>
  );
}
function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} B`;
}
