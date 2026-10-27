"use client";
import * as React from "react";

import md from "./upstream/AssistantMarkdown.module.css";
import { MessageIconActions } from "./upstream/MessageIconActions";
import { IconThinkOutlineRegular } from "./upstream/primitives/icons";
import { MarkdownDelegateProvider } from "./upstream/primitives/markdown/MarkdownDelegate";
import { MarkdownText } from "./upstream/primitives/markdown/MarkdownText";
import { TextShimmer } from "./upstream/primitives/TextShimmer";
import { ReasoningRow } from "./upstream/ReasoningRow";
import { useWorkbench } from "./workbench-context";

const LABELS = {
  code: {
    copyLabel: "复制代码",
    copiedLabel: "已复制",
    toolbarLabels: { codeLabel: "代码", wrapLabel: "自动换行", unwrapLabel: "取消自动换行" },
  },
  footnotes: "注释",
};
export function DshMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const wb = useWorkbench();
  return (
    <MarkdownDelegateProvider
      openFile={(path) => wb.openFile(path)}
      openExternalLink={(url) => window.open(url, "_blank", "noopener,noreferrer")}
    >
      <div className={md.root} data-dsh-markdown>
        <div className={md.body}>
          <MarkdownText text={text} streaming={streaming} labels={LABELS} />
        </div>
      </div>
    </MarkdownDelegateProvider>
  );
}
function useReasoningDisclosure() {
  const [expanded, setExpanded] = React.useState(false);
  return { expanded, toggle: React.useCallback(() => setExpanded((v) => !v), []) };
}
const presentation = <T,>(select: (policy: { settledReasoningPreview: boolean }) => T) =>
  select({ settledReasoningPreview: true });
const translate = (key: string) => (key === "message.think" ? "思考过程" : key === "row.running" ? "正在思考" : key);
const renderReasoning = (_name: string, props: { text: string; running: boolean }) => (
  <DshMarkdown text={props.text} streaming={props.running} />
);
export function DshReasoning({ text, running = false }: { text: string; running?: boolean }) {
  return (
    <ReasoningRow
      text={text}
      running={running}
      useDisclosure={useReasoningDisclosure}
      usePresentation={presentation}
      renderSlot={renderReasoning}
      t={translate}
    />
  );
}
const actionTranslate = (key: string, p?: Record<string, number>) =>
  ({
    copy: "复制消息",
    copied: "已复制",
    "message.branch": "从此处新建分支",
    "message.branchUnavailable": "生成完成后可分支",
  })[key] ?? (key === "clock.md" ? `${p?.m}月${p?.d}日` : key === "clock.ymd" ? `${p?.y}年${p?.m}月${p?.d}日` : key);
export function MessageActions({
  text,
  time,
  user = false,
  extra,
}: {
  text: string;
  time?: string;
  user?: boolean;
  extra?: React.ReactNode;
}) {
  const stamp = time ? new Date(time).valueOf() : undefined;
  return (
    <MessageIconActions
      text={text}
      time={stamp !== undefined && !Number.isNaN(stamp) ? stamp : undefined}
      clock={user ? "start" : "end"}
      extraActions={extra}
      t={actionTranslate}
    />
  );
}
export function Generating() {
  return (
    <div className="dsh-generating" role="status">
      <IconThinkOutlineRegular size={14} />
      <TextShimmer active>正在生成</TextShimmer>
    </div>
  );
}
