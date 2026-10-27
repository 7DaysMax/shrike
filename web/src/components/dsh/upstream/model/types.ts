import type { ReactNode } from "react";
export interface ModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}
export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}
export interface CatalogModel {
  profileId?: string;
  id: string;
  name: string;
  reasoning?: { efforts: ModelReasoningEffort[]; defaultEffort?: string; allowProviderDefault?: boolean };
}
export interface ModelLabelOwner {
  provider: { id: string; name: string };
  model: CatalogModel;
  placement: "trigger" | "menu" | "option";
  selected: boolean;
}
export interface ModelDirectoryState {
  current: ModelSelection | null;
  retainedEffort?: string;
  groups: { id: string; name: string; models: CatalogModel[] }[];
  status: "idle" | "loading" | "ready" | "selecting" | "error";
  pending: ModelSelection | null;
  error: string | null;
  failures: { id: string; name: string; message: string }[];
  routable: boolean | null;
}
export type SelectionResult = { ok: true; value?: void } | { ok: false; error: { code: string; message: string } };
export interface ModelSelectProps {
  locked: boolean;
  available: boolean;
  directory: { getSnapshot: () => ModelDirectoryState; subscribe: (f: () => void) => () => void };
  load: () => void;
  select: (s: ModelSelection) => Promise<SelectionResult | undefined>;
  t: (key: string, values?: Record<string, string>) => string;
  renderSlot: (name: string, owner: ModelLabelOwner, options: { fallback: ReactNode }) => ReactNode;
  effortPanel?: ReactNode;
  openRequest?:{pane:"model"|"effort";seq:number};
}
