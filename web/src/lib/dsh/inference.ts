import type { LLMProfile } from "../types";
import type { ModelDirectoryState, ModelSelection } from "@/components/dsh/upstream/model/types";
export interface InferenceSettings {
  profile_id: number | null;
  explicit_model: boolean;
  thinking_type: string;
  reasoning_effort: string;
}
export interface InferenceResponse {
  profiles?: LLMProfile[];
  default_profile?: LLMProfile | null;
  scope: "conversation" | "task";
  id: number;
  settings: InferenceSettings;
  effective: LLMProfile | null;
  levels: Record<string, string[] | null>;
}
export const DEFAULT_INFERENCE: InferenceSettings = {
  profile_id: null,
  explicit_model: false,
  thinking_type: "",
  reasoning_effort: "",
};
export const EFFORT_NAMES: Record<string, string> = {
  inherit: "默认",
  off: "关闭",
  minimal: "极低",
  low: "轻量",
  medium: "标准",
  high: "深入",
  xhigh: "更深入",
  max: "极致",
};
export function profileLevels(p?: LLMProfile | null) {
  if (!p) return [];
  const model = p.model.toLowerCase();
  let levels: string[] = [];
  if (/deepseek.*(flash|v4|pro)/.test(model)) levels = ["low", "high", "max"];
  else if (model.includes("claude")) {
    const five = /(opus|sonnet|haiku|fable|mythos)-5/.test(model);
    const modern = five || /4[-.][678]|mythos-preview/.test(model);
    if (modern || /opus-4[-.]5/.test(model)) levels = ["low", "medium", "high"];
    if (modern) {
      if (five || /4[-.][78]/.test(model)) levels.push("xhigh");
      levels.push("max");
    }
  } else if (/^gpt-[56]/.test(model)) {
    levels = ["low", "medium", "high"];
    if (/^gpt-6|^gpt-5\.(?!1)/.test(model)) levels.push("xhigh");
    else if (!model.startsWith("gpt-5.1")) levels.unshift("minimal");
  } else if (/^o[134]/.test(model)) levels = ["low", "medium", "high"];
  if (p.reasoning_effort && !levels.includes(p.reasoning_effort)) levels.push(p.reasoning_effort);
  return levels;
}
export function inferenceDirectory(data: InferenceResponse, profiles: LLMProfile[]): ModelDirectoryState {
  const choice = (p: LLMProfile | undefined | null, isDefault = false) => {
    const levels = p ? (data.levels[p.id] ?? profileLevels(p)) : [];
    const thinking = levels.length > 0 || !!p?.thinking_type;
    return {
      profileId: p?.id,
      id: isDefault ? "default" : p!.model,
      name: isDefault ? `跟随默认${p ? ` · ${p.model}` : ""}` : `${p!.model}`,
      reasoning: thinking
        ? {
            efforts: [
              "inherit",
              ...(/^((gpt-5)(-mini|-nano)?|o[134].*)$/.test(p?.model ?? "") ? [] : ["off"]),
              ...levels,
            ].map((id) => ({ id, name: EFFORT_NAMES[id] ?? id })),
            defaultEffort: "inherit",
          }
        : undefined,
    };
  };
  const groups = [
    {
      id: "default",
      name: "跟随 Agent / 默认配置",
      models: [
        choice(
          data.settings.explicit_model
            ? "default_profile" in data
              ? data.default_profile
              : data.effective
            : data.effective,
          true,
        ),
      ],
    },
    ...profiles.map((p) => ({ id: `profile-${p.id}`, name: p.name, models: [choice(p)] })),
  ];
  const current = data.settings.explicit_model
    ? {
        provider: `profile-${data.effective?.id ?? data.settings.profile_id}`,
        model: data.effective?.model ?? "unavailable",
      }
    : { provider: "default", model: "default" };
  const effort = data.settings.thinking_type === "disabled" ? "off" : data.settings.reasoning_effort || "inherit";
  return {
    current: { ...current, reasoningEffort: effort },
    groups,
    status: "ready",
    pending: null,
    error: null,
    failures: [],
    routable: !!data.effective,
  };
}
export function settingsForSelection(
  previous: InferenceSettings,
  current: ModelSelection | null,
  next: ModelSelection,
): { settings: InferenceSettings; set_model: boolean } {
  const set_model = current?.provider !== next.provider || current?.model !== next.model;
  const effort = next.reasoningEffort ?? "inherit";
  return {
    set_model,
    settings: {
      ...previous,
      ...(set_model
        ? {
            profile_id: next.provider === "default" ? null : Number(next.provider.replace("profile-", "")),
            explicit_model: next.provider !== "default",
          }
        : {}),
      reasoning_effort: ["inherit", "off"].includes(effort) ? "" : effort,
      thinking_type: effort === "off" ? "disabled" : effort === "inherit" ? "" : "enabled",
    },
  };
}
