"use client";
import * as React from "react";

import { acceptSnapshot, type LiveSnapshot, projectLive } from "@/lib/dsh/live-stream";
import type { Activity } from "@/lib/types";

const EMPTY: LiveSnapshot = { revision: -1, items: [] };
export function useLiveStream(
  scope: "task" | "conversation",
  id: string | number | undefined,
  activity: Activity[],
  mainSeg?: number,
) {
  const [state, setState] = React.useState<{ key: string; snapshot: LiveSnapshot }>({ key: "", snapshot: EMPTY });
  const key = id ? `${scope}:${id}` : "";
  React.useEffect(() => {
    if (!key) return;
    let alive = true,
      queued: LiveSnapshot | undefined,
      raf = 0;
    const token = localStorage.getItem("shrike_token");
    const query = new URLSearchParams({ scope, id: String(id) });
    if (token) query.set("token", token);
    const source = new EventSource(`/api/ui/live?${query}`);
    source.onmessage = (e) => {
      try {
        const value = JSON.parse(e.data) as LiveSnapshot;
        queued = value;
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (!alive || !queued) return;
            const next = queued;
            setState((prev) => ({ key, snapshot: acceptSnapshot(prev.key === key ? prev.snapshot : EMPTY, next) }));
          });
      } catch {
        /* A malformed frame never replaces visible text. */
      }
    };
    return () => {
      alive = false;
      source.close();
      cancelAnimationFrame(raf);
    };
  }, [key, scope, id]);
  return React.useMemo(
    () => projectLive(activity, state.key === key ? state.snapshot : EMPTY, mainSeg),
    [activity, state, key, mainSeg],
  );
}
