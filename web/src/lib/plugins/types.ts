import type { Manifest } from "./kernel";
export interface PluginInfo {
  manifest: Manifest;
  source: "builtin" | "local";
  enabled: boolean;
  versions: string[];
  error?: string;
}
export interface PluginPackage {
  manifest: Manifest;
  files: Record<string, string>;
}
