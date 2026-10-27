"use client";
import * as React from "react";
import { PluginKernel, type OwnedContribution, type Manifest } from "@/lib/plugins/kernel";
import type { PluginInfo } from "@/lib/plugins/types";
import builtin from "@/lib/plugins/builtin-catalog.json";
import { api } from "@/lib/api";
interface Host {
  kernel: PluginKernel;
  items: PluginInfo[];
  error: string;
  refresh: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean, version?: string) => Promise<void>;
}
const Context = React.createContext<Host | null>(null);
export function PluginHostProvider({ children }: { children: React.ReactNode }) {
  const [kernel, setKernel] = React.useState(() => new PluginKernel()),
    [items, setItems] = React.useState<PluginInfo[]>([]),
    [error, setError] = React.useState("");
  const current = React.useRef(kernel),
    fingerprint = React.useRef("");
  const generation = React.useRef(0),
    mounted = React.useRef(true);
  const inflight = React.useRef<Promise<void> | null>(null);
  const apply = React.useCallback(async (next: PluginInfo[]) => {
    const signature = JSON.stringify(next);
    if (signature === fingerprint.current) return;
    const request = ++generation.current;
    const k = new PluginKernel();
    for (const item of next) {
      if (item.error) continue;
      const m = item.manifest;
      k.register({
        manifest: m,
        activate: (ctx) => {
          for (const c of m.contributions ?? []) ctx.contribute(c);
        },
      });
    }
    for (const item of next) {
      if (item.enabled && !item.error) {
        try {
          await k.activate(item.manifest.id);
        } catch (e) {
          setError(String(e));
        }
      }
    }
    if (!mounted.current || request !== generation.current) {
      await k.dispose();
      return;
    }
    const old = current.current;
    current.current = k;
    fingerprint.current = signature;
    setKernel(k);
    setItems(next);
    void old.dispose();
  }, []);
  const refresh = React.useCallback(() => {
    if (inflight.current) return inflight.current;
    const p = api
      .plugins()
      .then(async (next) => {
        setError("");
        await apply(next);
      })
      .catch((e) => {
        setError(e.message);
        throw e;
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = p;
    return p;
  }, [apply]);
  React.useEffect(() => {
    mounted.current = true;
    let active = true;
    void apply(
      (builtin as Manifest[]).map((m) => ({ manifest: m, source: "builtin", enabled: true, versions: [m.version] })),
    );
    void refresh().catch(() => {
      /* Diagnostics are retained in host state. */
    });
    const timer = setInterval(() => {
      if (active)
        void refresh().catch(() => {
          /* Diagnostics are retained in host state. */
        });
    }, 5000);
    return () => {
      active = false;
      mounted.current = false;
      generation.current++;
      clearInterval(timer);
      void current.current.dispose();
    };
  }, [apply, refresh]);
  const setEnabled = React.useCallback(
    async (id: string, enabled: boolean, version?: string) => {
      await api.updatePlugin(id, enabled, version);
      if (inflight.current)
        await inflight.current.catch(() => {
          /* Fetch fresh state after the mutation. */
        });
      await refresh();
    },
    [refresh],
  );
  const value = React.useMemo(
    () => ({ kernel, items, error, refresh, setEnabled }),
    [kernel, items, error, refresh, setEnabled],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePluginHost() {
  const host = React.useContext(Context);
  if (!host) throw new Error("PluginHostProvider 缺失");
  return host;
}
export function useContributions(point: string) {
  const { kernel } = usePluginHost();
  const version = React.useSyncExternalStore(
    kernel.subscribe,
    () => kernel.version,
    () => 0,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: kernel.version invalidates the contribution snapshot.
  return React.useMemo(() => kernel.contributions(point), [kernel, point, version]);
}
export class PluginBoundary extends React.Component<
  { pluginId: string; children: React.ReactNode },
  { error: string }
> {
  state: { error: string } = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  render() {
    return this.state.error ? (
      <div role="alert" className="dsh-inline-error">
        插件 {this.props.pluginId} 出错：{this.state.error}
        <button type="button" onClick={() => this.setState({ error: "" })}>
          重试插件
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function contributionTab(c: OwnedContribution) {
  return {
    id: `plugin:${c.pluginId}:${c.id}`,
    kind: "plugin" as const,
    title: c.label,
    pluginId: c.pluginId,
    contributionId: c.id,
  };
}
export function findPanel(entries: OwnedContribution[], kind: string, pluginId?: string, contributionId?: string) {
  return entries.find((c) =>
    pluginId ? c.pluginId === pluginId && c.id === contributionId : c.id === kind && c.renderer?.startsWith("builtin."),
  );
}
