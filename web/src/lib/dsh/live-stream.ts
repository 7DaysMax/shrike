import type { Activity } from "../types";
export interface LiveSnapshot {
  revision: number;
  items: Activity[];
}
/** A cumulative frame replaces, rather than appends to, its prior token state.
 * Settled seq wins over a pending snapshot; stable stream ids survive settlement. */
export function projectLive(activity: Activity[], snapshot: LiveSnapshot, mainSeg?: number): Activity[] {
  const rows = new Map(activity.map((a) => [a.seq, a]));
  const active: Activity[] = [];
  for (const frame of snapshot.items) {
    if (mainSeg !== undefined && (frame.worker !== "mainagent" || (frame.main_seg ?? 0) !== mainSeg)) continue;
    if (!frame.stream_id) continue;
    if (frame.streaming) {
      active.push({ ...frame, seq: streamSeq(frame.stream_id) });
      continue;
    }
    if (frame.seq > 0) rows.set(frame.seq, { ...rows.get(frame.seq), ...frame });
  }
  // Committed history is sorted by the database sequence. Active blocks are the
  // causal tail and keep their server order (including reasoning -> response).
  return [...rows.values()].sort((a, b) => a.seq - b.seq).concat(active);
}
export function acceptSnapshot(previous: LiveSnapshot, next: LiveSnapshot): LiveSnapshot {
  return Number.isSafeInteger(next.revision) && next.revision >= previous.revision && Array.isArray(next.items)
    ? next
    : previous;
}
export function streamSeq(id: string) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return -1 - (h >>> 0);
}
