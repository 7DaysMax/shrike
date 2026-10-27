/** UI-only state. Engine state continues to come from the ARTEX API. */
export type PanelKind = "files" | "file" | "browser" | "terminal" | "tasks" | "approvals" | "task" | "plugin";
export interface WorkbenchTab {
  id: string;
  kind: PanelKind;
  title: string;
  pluginId?:string;
  contributionId?:string;
  taskId?: string;
  section?: string;
  path?: string;
  url?: string;
}
export interface WorkbenchState {
  tabs: WorkbenchTab[];
  active: string | null;
  open: boolean;
  fullscreen: boolean;
}
export const INITIAL_WORKBENCH: WorkbenchState = { tabs: [], active: null, open: false, fullscreen: false };
export type WorkbenchAction =
  | { type: "open"; tab: WorkbenchTab }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  | { type: "hide" }
  | { type: "show" }
  | { type: "fullscreen" }
  | { type: "restore"; state: WorkbenchState };
export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "open": {
      const found = state.tabs.some((t) => t.id === action.tab.id);
      return {
        ...state,
        tabs: found ? state.tabs.map((t) => (t.id === action.tab.id ? action.tab : t)) : [...state.tabs, action.tab],
        active: action.tab.id,
        open: true,
      };
    }
    case "select":
      return state.tabs.some((t) => t.id === action.id) ? { ...state, active: action.id, open: true } : state;
    case "close": {
      const index = state.tabs.findIndex((t) => t.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const active = state.active === action.id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : state.active;
      return {
        ...state,
        tabs,
        active,
        open: tabs.length > 0 && state.open,
        fullscreen: tabs.length > 0 && state.fullscreen,
      };
    }
    case "hide":
      return { ...state, open: false, fullscreen: false };
    case "show":
      return state.tabs.length ? { ...state, open: true } : state;
    case "fullscreen":
      return { ...state, fullscreen: !state.fullscreen };
    case "restore":
      return action.state;
  }
}
const kinds = new Set<PanelKind>(["files", "file", "browser", "terminal", "tasks", "approvals", "task", "plugin"]);
export function restoreWorkbench(raw: string | null): WorkbenchState {
  if (!raw) return INITIAL_WORKBENCH;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tabs)) return INITIAL_WORKBENCH;
    const ids = new Set<string>();
    const tabs: WorkbenchTab[] = parsed.tabs
      .filter((t: WorkbenchTab) => {
        if (!t || typeof t.id !== "string" || typeof t.title !== "string" || !kinds.has(t.kind) || ids.has(t.id))
          return false;
        if (t.path !== undefined && typeof t.path !== "string") return false;
        if (t.url !== undefined && typeof t.url !== "string") return false;
        if (t.kind === "task" && (typeof t.taskId !== "string" || !/^[1-9]\d*$/.test(t.taskId))) return false;
        if (t.section !== undefined && !["overview","sessions","graph","findings","assets","coverage","intercept","report","retests","broadcast"].includes(t.section)) return false;
        if(t.kind==="plugin"&&(typeof t.pluginId!=="string"||typeof t.contributionId!=="string"))return false;
        ids.add(t.id);
        return true;
      })
      .slice(0, 30);
    return {
      tabs,
      active: tabs.some((t) => t.id === parsed.active) ? parsed.active : (tabs[0]?.id ?? null),
      open: parsed.open === true && tabs.length > 0,
      fullscreen: false,
    };
  } catch {
    return INITIAL_WORKBENCH;
  }
}
export function panelGeometry(viewport: number, sidebar: number, preferred?: number) {
  const max = Math.min(viewport * 0.7, viewport - sidebar - 400);
  return { overlay: max < 300, width: Math.round(Math.max(300, Math.min(preferred ?? viewport * 0.45, max))) };
}
export function browserAddress(input: string): string | null {
  try {
    const url = new URL(
      /^(localhost|127\.\d+\.\d+\.\d+|\[[^\]]+\]):\d+(?:\/|$)/i.test(input)
        ? `http://${input}`
        : /^[a-z][a-z\d+.-]*:/i.test(input)
          ? input
          : `https://${input}`,
    );
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function fileKind(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  if (["csv", "tsv"].includes(ext)) return "table";
  return "text";
}
export function lineChanges(
  before: string,
  after: string,
): { type: "same" | "add" | "remove"; text: string; line: number }[] {
  const a = before.split("\n"),
    b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  return [
    ...a.slice(0, prefix).map((text, i) => ({ type: "same" as const, text, line: i + 1 })),
    ...a.slice(prefix, a.length - suffix).map((text, i) => ({ type: "remove" as const, text, line: prefix + i + 1 })),
    ...b.slice(prefix, b.length - suffix).map((text, i) => ({ type: "add" as const, text, line: prefix + i + 1 })),
    ...b.slice(b.length - suffix).map((text, i) => ({ type: "same" as const, text, line: b.length - suffix + i + 1 })),
  ];
}

/** A bounded CSV/TSV preview that retains escaped quotes and multiline cells. */
export function parseDelimited(text: string, delimiter = ",", limit = 1000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!cell || quoted) quoted = !quoted;
      else cell += char;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length >= limit) return rows;
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function conversationId(params: URLSearchParams): number | null {
  const raw = params.get("c");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
