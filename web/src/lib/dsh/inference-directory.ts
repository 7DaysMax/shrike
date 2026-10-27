import { inferenceDirectory, settingsForSelection, type InferenceResponse } from "./inference";
import type { LLMProfile } from "../types";
import type { ModelDirectoryState, ModelSelection, SelectionResult } from "@/components/dsh/upstream/model/types";
/** At most one write in flight and one latest pending choice. Slow networks cannot
 * replay stale drag values after the final snap, or overwrite a newer load. */
export class InferenceDirectory {
  private listeners = new Set<() => void>();
  private data: InferenceResponse | null = null;
  private state: ModelDirectoryState = {
    current: null,
    groups: [],
    status: "idle",
    pending: null,
    error: null,
    failures: [],
    routable: null,
  };
  private revision = 0;
  private loading: Promise<void> | null = null;
  private running = false;
  private pending: { value: ModelSelection; waiters: ((r: SelectionResult) => void)[] } | null = null;
  private disposed = false;
  constructor(
    private profiles: () => LLMProfile[],
    private read: () => Promise<InferenceResponse>,
    private write: (v: ReturnType<typeof settingsForSelection>) => Promise<InferenceResponse>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly store = { getSnapshot: this.getSnapshot, subscribe: this.subscribe };
  private update(state: ModelDirectoryState) {
    if (this.disposed) return;
    this.state = state;
    for (const fn of this.listeners) fn();
  }
  load = (silent = false) => {
    if (this.loading !== null) return this.loading;
    if (this.running) return Promise.resolve();
    const stamp = this.revision;
    if (!silent || this.data === null) this.update({ ...this.state, status: "loading" });
    const request: Promise<void> = this.read()
      .then((data) => {
        if (this.disposed || stamp !== this.revision) return;
        this.data = data;
        this.update(inferenceDirectory(data, data.profiles ?? this.profiles()));
      })
      .catch((e) => {
        if (this.disposed || stamp !== this.revision) return;
        this.update({ ...this.state, status: "error", error: (e as Error).message });
        throw e;
      })
      .finally(() => {
        if (this.loading === request) this.loading = null;
      });
    this.loading = request;
    return request;
  };
  select = (value: ModelSelection) =>
    new Promise<SelectionResult>((resolve) => {
      if (this.disposed) {
        resolve({ ok: false, error: { code: "closed", message: "会话已切换" } });
        return;
      }
      this.revision++;
      if (this.pending) {
        this.pending.value = value;
        this.pending.waiters.push(resolve);
      } else this.pending = { value, waiters: [resolve] };
      this.update({ ...this.state, status: "selecting", pending: value });
      void this.drain();
    });
  private queued() {
    return this.pending;
  }
  revive() {
    this.disposed = false;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending && !this.disposed) {
        const next = this.pending;
        this.pending = null;
        let result: SelectionResult;
        try {
          if (!this.data) throw new Error("模型目录尚未就绪");
          const data = await this.write(settingsForSelection(this.data.settings, this.state.current, next.value));
          this.data = data;
          const queued = this.queued();
          this.update({
            ...inferenceDirectory(data, data.profiles ?? this.profiles()),
            ...(queued ? { status: "selecting" as const, pending: queued.value } : {}),
          });
          result = { ok: true };
        } catch (e) {
          this.update({ ...this.state, status: "ready", pending: null, error: (e as Error).message });
          result = { ok: false, error: { code: "selection_failed", message: (e as Error).message } };
        }
        for (const resolve of next.waiters) resolve(result);
      }
    } finally {
      this.running = false;
    }
  }
  dispose() {
    this.disposed = true;
    this.revision++;
    this.loading = null;
    this.listeners.clear();
    if (this.pending)
      for (const resolve of this.pending.waiters)
        resolve({ ok: false, error: { code: "closed", message: "会话已切换" } });
    this.pending = null;
  }
}
