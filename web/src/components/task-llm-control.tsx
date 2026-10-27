"use client";
import * as React from "react";

import { IconAlertCircle } from "@tabler/icons-react";
import { toast } from "sonner";

import { ModelBrandIcon } from "@/components/model-brand-icon";
import { TaskLLMProfileChain } from "@/components/task-llm-profile-chain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import type { LLMProfile, Task } from "@/lib/types";

function taskProfileIDs(task: Task): string[] {
  if (task.llm_profile_ids && task.llm_profile_ids.length > 0) {
    return task.llm_profile_ids.map(String);
  }
  return task.llm_profile_id ? [String(task.llm_profile_id)] : [];
}

export function TaskLLMControl({
  task,
  profiles,
  onUpdated,
  triggerLabel,
}: {
  task: Task;
  profiles: LLMProfile[];
  onUpdated: () => void;
  triggerLabel?:string;
}) {
  const [open, setOpen] = React.useState(false);
  const [profileIDs, setProfileIDs] = React.useState<string[]>(() => taskProfileIDs(task));
  const [activeProfileID, setActiveProfileID] = React.useState(
    task.active_llm_profile_id ? String(task.active_llm_profile_id) : (taskProfileIDs(task)[0] ?? ""),
  );
  const [saving, setSaving] = React.useState(false);
  const popoverContentRef = React.useRef<HTMLDivElement>(null);

  const chain = taskProfileIDs(task);
  const exhausted = task.llm_failover_state === "chain_exhausted";
  // 任何状态都可以改链,终态也不例外:任务结束后主 Agent 对话仍走这条链,
  // 链上模型出问题时必须能换掉,否则已完成任务就没法继续交互。
  const terminal = ["done", "failed", "timeout"].includes(task.status);
  // A null active profile on an exhausted, non-empty chain is a persisted end
  // cursor. Keep the status display honest; choosing the first profile is only
  // the editor's reset draft and does not mean it is currently active.
  let activeID = chain[0] ?? "";
  if (exhausted) activeID = "";
  if (task.active_llm_profile_id) activeID = String(task.active_llm_profile_id);
  const activeProfile =
    profiles.find((profile) => profile.id === activeID) ??
    (!activeID && !exhausted ? profiles.find((profile) => profile.is_default) : undefined);
  const currentLabel = exhausted
    ? "配置链已耗尽"
    : (activeProfile?.name ?? (activeID ? `配置 #${activeID}` : "跟随默认配置"));
  const activeIndex = chain.indexOf(activeID);
  const backupCount = activeIndex >= 0 ? Math.max(0, chain.length - activeIndex - 1) : 0;
  const currentTitle = [currentLabel, activeProfile?.model, backupCount > 0 ? `${backupCount} 个备用` : ""]
    .filter(Boolean)
    .join(" · ");
  let editorDescription = "调整顺序或当前配置后，将从下一次 LLM 调用开始生效。";
  if (terminal) editorDescription = "任务已结束，改动只影响后续的主 Agent 对话。";
  let saveLabel = "保存";
  if (exhausted) saveLabel = "保存并重置";
  if (saving) saveLabel = "保存中";

  const syncDraft = React.useCallback(() => {
    const next = taskProfileIDs(task);
    setProfileIDs(next);
    setActiveProfileID(task.active_llm_profile_id ? String(task.active_llm_profile_id) : (next[0] ?? ""));
  }, [task]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) syncDraft();
  };

  const handleProfileIDsChange = (next: string[]) => {
    setProfileIDs(next);
    setActiveProfileID((current) => (next.includes(current) ? current : (next[0] ?? "")));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.updateTaskLLMProfiles(
        task.id,
        profileIDs.map(Number),
        activeProfileID ? Number(activeProfileID) : undefined,
      );
      if (result.switch_event) {
        toast.info(result.switch_event.summary, { id: `task-${task.id}-llm-${result.switch_event.seq}` });
      } else {
        toast.success(
          result.reopened_intents > 0
            ? `LLM 配置已更新，并恢复 ${result.reopened_intents} 条额度阻塞意图`
            : "LLM 配置已更新",
        );
      }
      setOpen(false);
      onUpdated();
    } catch (error) {
      toast.error(`更新失败：${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={exhausted ? "destructive" : "outline"}
          aria-label="查看或切换任务 LLM 配置"
          title={currentTitle}
        >
          <ModelBrandIcon profile={activeProfile} />
          <span className="hidden max-w-36 truncate lg:inline">{triggerLabel??currentLabel}</span>
          {backupCount > 0 && <span className="hidden text-muted-foreground xl:inline">+{backupCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent ref={popoverContentRef} align="start" className="w-[min(28rem,calc(100vw-2rem))] gap-4 p-4">
        <PopoverHeader>
          <PopoverTitle>任务 LLM 配置链</PopoverTitle>
          <PopoverDescription>{editorDescription}</PopoverDescription>
        </PopoverHeader>

        {exhausted && (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>配置链额度已耗尽</AlertTitle>
            <AlertDescription>
              {task.llm_failover_reason ?? "所有已选配置均被判定为额度不足。保存配置链可重置故障状态。"}
            </AlertDescription>
          </Alert>
        )}

        <TaskLLMProfileChain
          profiles={profiles}
          value={profileIDs}
          onValueChange={handleProfileIDsChange}
          activeProfileId={activeProfileID}
          onActiveProfileChange={setActiveProfileID}
          inputId="task-llm-profiles"
          disabled={saving}
          portalContainer={popoverContentRef}
        />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            关闭
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving && <Spinner data-icon="inline-start" />}
            {saveLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
