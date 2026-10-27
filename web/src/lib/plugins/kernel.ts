/** Host-neutral plugin lifecycle. React, transport and business APIs are adapters. */
export type PluginState = "registered" | "starting" | "active" | "failed" | "stopping";
export interface Manifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  description?: string;
  required?: boolean;
  dependencies?: string[];
  permissions?: string[];
  contributions?: Contribution[];
}
export interface Contribution {
  point: string;
  id: string;
  label: string;
  renderer?: string;
  command?: string;
  target?: string;
  when?: string;
  order?: number;
  [key: string]: unknown;
}
export interface OwnedContribution extends Contribution {
  pluginId: string;
  key: string;
}
export interface PluginContext {
  readonly signal: AbortSignal;
  contribute: (value: Contribution) => () => void;
  dispose: (cleanup: () => void | Promise<void>) => void;
  on: (event: string, listener: (payload: unknown) => void) => () => void;
  emit: (event: string, payload: unknown) => void;
  service: (key: string, handler: (input: unknown, signal: AbortSignal) => unknown | Promise<unknown>) => () => void;
  invoke: (key: string, input: unknown) => Promise<unknown>;
}
export interface Definition {
  manifest: Manifest;
  activate: (ctx: PluginContext) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
interface RecordEntry {
  definition: Definition;
  state: PluginState;
  error?: string;
  controller?: AbortController;
  cleanups: (() => void | Promise<void>)[];
}
export class PluginKernel {
  private records = new Map<string, RecordEntry>();
  private entries = new Map<string, OwnedContribution>();
  private listeners = new Set<() => void>();
  private events = new Map<string, Set<(payload: unknown) => void>>();
  private services = new Map<
    string,
    { owner: string; handler: (input: unknown, signal: AbortSignal) => unknown | Promise<unknown> }
  >();
  private serial: Promise<unknown> = Promise.resolve();
  version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }
  private operation<T>(run: () => Promise<T>): Promise<T> {
    const next = this.serial.then(run, run);
    this.serial = next.catch(() => {
      /* The caller still receives rejection; keep the lifecycle queue usable. */
    });
    return next;
  }
  register(definition: Definition) {
    const m = definition.manifest;
    if (m.apiVersion !== 1 || !m.id || this.records.has(m.id)) throw new Error(`插件协议或 ID 重复：${m.id}`);
    this.records.set(m.id, { definition, state: "registered", cleanups: [] });
    this.changed();
    return () => this.unregister(m.id);
  }
  async unregister(id: string) {
    await this.deactivate(id);
    this.records.delete(id);
    this.changed();
  }
  status(id: string) {
    const r = this.records.get(id);
    return r ? { id, state: r.state, error: r.error } : undefined;
  }
  list() {
    return [...this.records].map(([id, r]) => ({
      id,
      manifest: r.definition.manifest,
      state: r.state,
      error: r.error,
    }));
  }
  contributions(point: string) {
    return [...this.entries.values()]
      .filter((c) => c.point === point)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key));
  }
  activate(id: string) {
    return this.operation(() => this.start(id, []));
  }
  private async start(id: string, path: string[]): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`依赖插件缺失：${id}`);
    if (r.state === "active") return;
    if (path.includes(id)) throw new Error(`循环依赖：${[...path, id].join(" → ")}`);
    for (const dep of r.definition.manifest.dependencies ?? []) await this.start(dep, [...path, id]);
    r.state = "starting";
    r.error = undefined;
    const controller = new AbortController();
    r.controller = controller;
    this.changed();
    const own = (cleanup: () => void | Promise<void>) => {
      if (controller.signal.aborted) {
        try {
          void Promise.resolve(cleanup()).catch((e) => {
            r.error = String(e);
            this.changed();
          });
        } catch (e) {
          r.error = String(e);
          this.changed();
        }
        return () => {
          /* The stopped scope has already disposed this resource. */
        };
      }
      let live = true;
      const once = () => {
        if (!live) return;
        live = false;
        return cleanup();
      };
      r.cleanups.push(once);
      return once;
    };
    const context: PluginContext = {
      signal: controller.signal,
      dispose: own,
      contribute: (value) => {
        if (controller.signal.aborted) throw new Error("插件已停止");
        const key = `${value.point}:${id}:${value.id}`;
        if (!value.point || !value.id || this.entries.has(key)) throw new Error(`贡献点重复：${key}`);
        this.entries.set(key, { ...value, pluginId: id, key });
        this.changed();
        return own(() => {
          this.entries.delete(key);
          this.changed();
        });
      },
      on: (name, listener) => {
        const list = this.events.get(name) ?? new Set();
        list.add(listener);
        this.events.set(name, list);
        return own(() => {
          list.delete(listener);
          if (!list.size) this.events.delete(name);
        });
      },
      emit: (name, payload) => {
        if (controller.signal.aborted) return;
        for (const listener of this.events.get(name) ?? []) {
          try {
            listener(payload);
          } catch (e) {
            r.error = `事件 ${name}: ${String(e)}`;
            this.changed();
          }
        }
      },
      service: (key, handler) => {
        if (this.services.has(key)) throw new Error(`服务已被占用：${key}`);
        this.services.set(key, { owner: id, handler });
        return own(() => {
          if (this.services.get(key)?.owner === id) this.services.delete(key);
        });
      },
      invoke: async (key, input) => {
        if (controller.signal.aborted) throw new Error("插件已停止");
        const service = this.services.get(key);
        if (!service) throw new Error(`服务未注册：${key}`);
        if (service.owner !== id && !(r.definition.manifest.permissions ?? []).includes(key))
          throw new Error(`插件未声明服务：${key}`);
        return service.handler(input, controller.signal);
      },
    };
    try {
      const cleanup = await r.definition.activate(context);
      if (cleanup) own(cleanup);
      r.state = "active";
      this.changed();
    } catch (e) {
      r.error = String(e);
      await this.cleanup(r);
      r.state = "failed";
      this.changed();
      throw e;
    }
  }
  private async cleanup(r: RecordEntry) {
    r.controller?.abort();
    for (const clean of r.cleanups.splice(0).reverse()) {
      try {
        await clean();
      } catch (e) {
        r.error = String(e);
      }
    }
  }
  deactivate(id: string) {
    return this.operation(async () => {
      const r = this.records.get(id);
      if (!r) return;
      const dependent = [...this.records].find(
        ([, v]) => v.state === "active" && v.definition.manifest.dependencies?.includes(id),
      );
      if (dependent) throw new Error(`请先停用依赖方：${dependent[0]}`);
      if (r.definition.manifest.required) throw new Error("宿主插件保持启用");
      r.state = "stopping";
      this.changed();
      await this.cleanup(r);
      r.state = "registered";
      this.changed();
    });
  }
  dispose() {
    return this.operation(async () => {
      for (const r of [...this.records.values()].reverse()) await this.cleanup(r);
      this.records.clear();
      this.entries.clear();
      this.events.clear();
      this.services.clear();
      this.changed();
    });
  }
}
