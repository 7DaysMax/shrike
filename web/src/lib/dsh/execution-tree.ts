import type { Activity } from "../types";
export type Group =
  | { type: "user"; key: string | number; step: Activity; intent?: boolean }
  | { type: "answer"; key: string | number; step: Activity }
  | { type: "round"; key: string | number; label: string }
  | { type: "tool"; key: string | number; worker: string; use?: Activity; result?: Activity }
  | { type: "msg"; key: string | number; worker: string; steps: Activity[] }
  | { type: "intercept"; key: string | number; step: Activity };

export function groupSteps(steps: Activity[], chat: boolean): Group[] {
  const out: Group[] = [];
  const byToolId = new Map<string, ToolGroup[]>();
  for (const s of steps) {
    if (s.kind === "usage") continue; // live token-usage marker — not a rendered step
    if (s.kind === "round") {
      out.push({ type: "round", key: s.stream_id ?? s.seq, label: s.summary || "新一轮" }); // planner round boundary
      continue;
    }
    if (s.kind === "intercept_request") {
      out.push({ type: "intercept", key: s.stream_id ?? s.seq, step: s });
      continue;
    }
    if (s.kind === "user" || s.kind === "intent") {
      // human turn OR the LLM-generated intent leading a worker session — both are
      // right-aligned bubbles; `intent` swaps the avatar to a non-human icon.
      out.push({ type: "user", key: s.stream_id ?? s.seq, step: s, intent: s.kind === "intent" });
      continue;
    }
    // In a chat (main agent) the assistant's text/result IS the answer — render it
    // full (markdown), never collapsed. thinking still folds into a compact block.
    if (s.kind === "result" || (chat && s.kind === "text")) {
      out.push({ type: "answer", key: s.stream_id ?? s.seq, step: s });
      continue;
    }
    if (s.kind === "tool_use") {
      const g: Extract<Group, { type: "tool" }> = { type: "tool", key: s.stream_id ?? s.seq, worker: s.worker, use: s };
      if (s.tool_use_id) {
        const key = `${toolScope(s)}:${s.tool_use_id}`;
        const queue = byToolId.get(key) ?? [];
        queue.push(g);
        byToolId.set(key, queue);
      }
      out.push(g);
      continue;
    }
    if (s.kind === "tool_result") {
      // bind to its tool_use by id (NOT adjacency — tools can run in parallel)
      const key = `${toolScope(s)}:${s.tool_use_id}`;
      const queue = s.tool_use_id ? byToolId.get(key) : undefined;
      const g = queue?.shift();
      if (queue?.length === 0) byToolId.delete(key);
      if (g && !g.result) g.result = s;
      else out.push({ type: "tool", key: s.stream_id ?? s.seq, worker: s.worker, result: s }); // orphan result
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.type === "msg" && last.worker === s.worker) last.steps.push(s);
    else out.push({ type: "msg", key: s.stream_id ?? s.seq, worker: s.worker, steps: [s] });
  }
  return out;
}

export type ToolGroup = Extract<Group, { type: "tool" }>;
export interface TaskToolGroup {
  type: "task-tools";
  key: string;
  worker: string;
  sourceTaskId?: string;
  label: string;
  tools: ToolGroup[];
  settled: boolean;
}
export type ExecutionGroup = Group | TaskToolGroup;
function toolScope(row: Activity) {
  return JSON.stringify([row.source_task_id ?? "", row.worker, row.intent_id ?? "", row.main_seg ?? 0]);
}
function promptLabel(summary: string) {
  let text = summary;
  try {
    const p = JSON.parse(summary);
    if (typeof p.text === "string") text = p.text;
  } catch {
    /* Most user prompts are plain text. */
  }
  return text.replace(/\s+/g, " ").trim();
}
/** Conversation (level 1) -> task execution (level 2) -> tool calls (level 3).
 * This is a presentation group, never a new persisted task. Answers/approvals
 * stay in the main flow. Parallel tool results remain paired by owner + ID. */
export function nestToolGroups(groups: Group[]): ExecutionGroup[] {
  const out: ExecutionGroup[] = [];
  const active = new Map<string, TaskToolGroup>();
  let label = "";
  for (const group of groups) {
    if (group.type === "user" || group.type === "round") {
      for (const parent of active.values()) parent.settled = true;
      active.clear();
      label = promptLabel(group.type === "user" ? group.step.summary : group.label);
    }
    if (group.type !== "tool") {
      out.push(group);
      if (group.type === "answer" && group.step.kind === "result") {
        const owner = toolScope(group.step);
        const parent = active.get(owner);
        if (parent) parent.settled = true;
        active.delete(owner);
      }
      continue;
    }
    const row = group.use ?? group.result;
    if (!row) continue;
    const owner = toolScope(row);
    let parent = active.get(owner);
    if (!parent) {
      parent = {
        type: "task-tools",
        key: `task-tools:${group.worker}:${group.key}`,
        worker: group.worker,
        sourceTaskId: row.source_task_id,
        label,
        tools: [],
        settled: false,
      };
      active.set(owner, parent);
      out.push(parent);
    }
    parent.tools.push(group);
  }
  return out;
}
export function toolState(group: ToolGroup, live: boolean) {
  if (group.result) return group.result.is_error ? "failed" : "succeeded";
  return live && !group.use?.inherited ? "running" : "interrupted";
}
export function toolTaskSummary(group: TaskToolGroup, live: boolean) {
  const counts = { total: group.tools.length, running: 0, succeeded: 0, failed: 0, interrupted: 0 };
  for (const tool of group.tools) counts[toolState(tool, live && !group.settled)]++;
  return counts;
}
export function containsFocusedTool(group: TaskToolGroup, seq?: number) {
  return seq != null && group.tools.some((tool) => tool.use?.seq === seq || tool.result?.seq === seq);
}
