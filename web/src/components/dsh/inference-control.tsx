"use client";
import * as React from "react";
import { api } from "@/lib/api";
import { InferenceDirectory } from "@/lib/dsh/inference-directory";
import { DEFAULT_INFERENCE, profileLevels, type InferenceSettings, type InferenceResponse } from "@/lib/dsh/inference";
import type { LLMProfile } from "@/lib/types";
import { ModelSelect } from "./upstream/model/ModelSelect";
import { zh } from "./upstream/model/locales";
import { EffortPanel } from "./upstream/model/effort/EffortPanel";
import { ModelBrandIcon } from "@/components/model-brand-icon";
import { useWorkbench } from "./workbench-context";
export function InferenceControl({
  scope = "conversation",
  id,
  profiles: given,
  draft,
  onDraftChange,
  defaultProfileId,
  disabled = false,
  rightSlot,
}: {
  scope?: "conversation" | "task";
  id?: number | string;
  profiles?: LLMProfile[];
  draft?: InferenceSettings;
  onDraftChange?: (s: InferenceSettings) => void;
  defaultProfileId?: number;
  disabled?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const [profileRevision, setProfileRevision] = React.useState(0);
  const [loadedProfiles, setProfiles] = React.useState<LLMProfile[] | null>(null);
  const profiles = loadedProfiles ?? given ?? [];
  const latest = React.useRef({ profiles, draft, onDraftChange, defaultProfileId });
  latest.current = { profiles, draft, onDraftChange, defaultProfileId };
  const [error, setError] = React.useState("");
  const wb = useWorkbench();
  const bar = React.useRef<HTMLFieldSetElement>(null);
  const [openRequest, setOpenRequest] = React.useState<{ pane: "model" | "effort"; seq: number }>();
  React.useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const open = (event: Event) => {
      const pane = (event as CustomEvent).detail;
      if (pane === "model" || pane === "effort")
        setOpenRequest((previous) => ({ pane, seq: (previous?.seq ?? 0) + 1 }));
    };
    node.addEventListener("artex:inference-open", open);
    return () => node.removeEventListener("artex:inference-open", open);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: profileRevision is the explicit retry trigger.
  React.useEffect(() => {
    if (given) return;
    let alive = true;
    api
      .llmProfiles()
      .then((p) => {
        if (alive) setProfiles(p);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [given, profileRevision]);
  const local = React.useRef(draft ?? DEFAULT_INFERENCE);
  const directory = React.useMemo(() => {
    const response = (settings: InferenceSettings): InferenceResponse => ({
      scope,
      id: Number(id) || 0,
      settings,
      default_profile:
        latest.current.profiles.find((p) => Number(p.id) === latest.current.defaultProfileId) ??
        latest.current.profiles.find((p) => p.is_default) ??
        null,
      effective: settings.explicit_model
        ? (latest.current.profiles.find((p) => Number(p.id) === settings.profile_id) ?? null)
        : (latest.current.profiles.find((p) => Number(p.id) === latest.current.defaultProfileId) ??
          latest.current.profiles.find((p) => p.is_default) ??
          null),
      levels: Object.fromEntries(latest.current.profiles.map((p) => [p.id, profileLevels(p)])),
    });
    return new InferenceDirectory(
      () => latest.current.profiles,
      async () => {
        if (!id) return response(latest.current.draft ?? local.current);
        const data = await api.uiInference(scope, id);
        if (data.profiles) setProfiles(data.profiles);
        return data;
      },
      async (input) => {
        if (id) return api.setUIInference(scope, id, input);
        local.current = input.settings;
        latest.current.onDraftChange?.(input.settings);
        return response(input.settings);
      },
    );
  }, [scope, id]);
  React.useEffect(() => {
    directory.revive();
    void directory
      .load()
      .then(() => setError(""))
      .catch((e) => setError(e.message));
    const t = setInterval(
      () =>
        void directory
          .load(true)
          .then(() => setError(""))
          .catch((e) => setError(e.message)),
      8000,
    );
    return () => {
      clearInterval(t);
      directory.dispose();
    };
  }, [directory]);
  const draftFingerprint = JSON.stringify([draft, defaultProfileId]);
  const fingerprint = JSON.stringify(profiles.map((p) => [p.id, p.name, p.model, p.reasoning_effort, p.thinking_type]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftFingerprint invalidates a local draft projection without rebuilding the shared directory.
  React.useEffect(() => {
    if (fingerprint !== "[]")
      void directory
        .load()
        .then(() => setError(""))
        .catch((e) => setError(e.message));
  }, [directory, fingerprint, draftFingerprint]);
  return (
    <fieldset ref={bar} data-inference-control className="dsh-inference-bar">
      <legend className="sr-only">模型与思考强度</legend>
      <ModelSelect
        available
        openRequest={openRequest}
        locked={disabled}
        directory={directory}
        load={() =>
          void directory
            .load()
            .then(() => setError(""))
            .catch((e) => setError(e.message))
        }
        select={directory.select}
        t={(key, values) => {
          let text = (zh as Record<string, string>)[key] ?? key;
          for (const [k, v] of Object.entries(values ?? {})) text = text.replaceAll(`{${k}}`, v);
          return text;
        }}
        renderSlot={(_name, owner, { fallback }) => {
          const profile =
            profiles.find((p) => p.id === owner.model.profileId) ??
            profiles.find((p) => owner.provider.id === `profile-${p.id}`);
          return (
            <span className="dsh-inline-model">
              <ModelBrandIcon profile={profile} />
              {fallback}
            </span>
          );
        }}
        effortPanel={
          <EffortPanel
            sessionId={`${scope}:${id ?? "draft"}`}
            directory={directory}
            onClose={() =>
              document
                .querySelector('[role="menu"][aria-label="模型与推理等级"]')
                ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
            }
          />
        }
      />
      <button type="button" className="dsh-text-button" onClick={() => wb.setSettings("models")}>
        管理模型
      </button>
      <span
        className="dsh-inference-hint"
        title={
          scope === "task"
            ? "影响本任务后续 Agent 请求，正在执行中的请求保持不变"
            : "仅影响本会话下一轮对话，当前回复保持不变；不修改其他会话或共享模型配置"
        }
      >
        {scope === "task" ? "本任务 · 下次调用生效" : "本会话 · 下一轮生效"}
      </span>
      {rightSlot}
      {error && (
        <div role="alert">
          <button
            type="button"
            className="dsh-inline-error"
            onClick={() => {
              setError("");
              setProfileRevision((v) => v + 1);
              void directory
                .load()
                .then(() => setError(""))
                .catch((e) => setError(e.message));
            }}
          >
            模型设置加载失败：{error} · 重试
          </button>
        </div>
      )}
    </fieldset>
  );
}
