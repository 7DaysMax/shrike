"use client";

import * as React from "react";
import {
  IconChevronRight,
  IconFolder,
  IconFile,
  IconRefresh,
  IconUpload,
  IconFolderPlus,
  IconDownload,
  IconDeviceFloppy,
  IconArrowLeft,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { WorkspaceEntry, WorkspaceFile } from "@/lib/types";
import { fileKind, lineChanges, parseDelimited } from "@/lib/dsh/workbench";
import { Markdown } from "@/components/markdown";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useWorkbench } from "./workbench-context";

function TreeDirectory({ path, depth = 0, refresh }: { path: string; depth?: number; refresh: number }) {
  const { openFile } = useWorkbench();
  const [entries, setEntries] = React.useState<WorkspaceEntry[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the directory reload generation.
  React.useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    api
      .workspaceList(path)
      .then((r) => {
        if (!disposed)
          setEntries([...r.entries].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
      })
      .catch((e: Error) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [path, refresh]);
  if (error)
    return (
      <div className="dsh-inline-error" role="alert">
        {error}
      </div>
    );
  if (loading)
    return (
      <div className="dsh-panel-message" role="status">
        正在读取目录…
      </div>
    );
  return (
    <>
      {!entries.length && <div className="dsh-tree-empty">空目录</div>}
      {entries.map((entry) => (
        <React.Fragment key={entry.path}>
          <button
            type="button"
            className="dsh-tree-row"
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() =>
              entry.dir
                ? setExpanded((current) => {
                    const next = new Set(current);
                    next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
                    return next;
                  })
                : openFile(entry.path)
            }
            title={entry.path}
            aria-expanded={entry.dir ? expanded.has(entry.path) : undefined}
          >
            {entry.dir ? (
              <>
                <IconChevronRight
                  size={13}
                  style={{ transform: expanded.has(entry.path) ? "rotate(90deg)" : undefined }}
                />
                <IconFolder size={16} />
              </>
            ) : (
              <>
                <span className="dsh-tree-spacer" />
                <IconFile size={16} />
              </>
            )}
            <span>{entry.name}</span>
            {!entry.dir && (
              <small>{entry.size < 1024 ? `${entry.size} B` : `${Math.round(entry.size / 1024)} KB`}</small>
            )}
          </button>
          {entry.dir && expanded.has(entry.path) && (
            <TreeDirectory path={entry.path} depth={depth + 1} refresh={refresh} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}
export function FilesPanel() {
  const [path, setPath] = React.useState("");
  const [input, setInput] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [directory, setDirectory] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const upload = React.useRef<HTMLInputElement>(null);
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      await api.workspaceUpload(path, files);
      setRefresh((n) => n + 1);
      toast.success("文件已上传");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dsh-files-panel">
      <div className="dsh-panel-toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPath(input.replace(/^\/+|\/+$/g, ""));
          }}
        >
          <label className="sr-only" htmlFor="dsh-folder-path">
            目录路径
          </label>
          <input
            id="dsh-folder-path"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="工作空间 / 子目录"
          />
          <button type="submit" className="dsh-icon-btn" aria-label="打开目录">
            <IconChevronRight size={16} />
          </button>
        </form>
        <button type="button" className="dsh-icon-btn" onClick={() => setRefresh((n) => n + 1)} aria-label="刷新文件">
          <IconRefresh size={16} />
        </button>
        <button type="button" className="dsh-icon-btn" onClick={() => setDirectory("")} aria-label="新建目录">
          <IconFolderPlus size={16} />
        </button>
        <button
          type="button"
          className="dsh-icon-btn"
          onClick={() => upload.current?.click()}
          disabled={busy}
          aria-label="上传文件"
        >
          <IconUpload size={16} />
        </button>
        <input
          type="file"
          multiple
          hidden
          ref={upload}
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <div className="dsh-panel-scroll">
        <TreeDirectory path={path} refresh={refresh} />
      </div>
      <Dialog
        open={directory !== null}
        onOpenChange={(open) => {
          if (!open) setDirectory(null);
        }}
      >
        <DialogContent>
          <DialogTitle>新建目录</DialogTitle>
          <DialogDescription>在当前工作空间目录下创建文件夹。</DialogDescription>
          <form
            className="dsh-simple-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!directory?.trim() || busy) return;
              setBusy(true);
              try {
                await api.workspaceMkdir([path, directory.trim()].filter(Boolean).join("/"));
                setDirectory(null);
                setRefresh((n) => n + 1);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label htmlFor="dsh-new-directory">目录名称</label>
            <input
              id="dsh-new-directory"
              autoFocus
              required
              value={directory ?? ""}
              onChange={(e) => setDirectory(e.target.value)}
            />
            <button type="submit" className="dsh-primary-button" disabled={busy}>
              创建目录
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function FilePanel({ path }: { path: string }) {
  const wb = useWorkbench();
  const [file, setFile] = React.useState<WorkspaceFile>();
  const [original, setOriginal] = React.useState("");
  const [content, setContent] = React.useState("");
  const [blobUrl, setBlobUrl] = React.useState("");
  const [mode, setMode] = React.useState("preview");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [remove, setRemove] = React.useState(false);
  const kind = fileKind(path),
    dirty = content !== original;
  React.useEffect(() => {
    wb.setTabDirty(`file:${path}`, dirty);
    return () => wb.setTabDirty(`file:${path}`, false);
  }, [path, dirty, wb.setTabDirty]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly reloads the selected file.
  React.useEffect(() => {
    let disposed = false,
      url = "";
    setFile(undefined);
    setError("");
    setBlobUrl("");
    api
      .workspaceRead(path)
      .then(async (f) => {
        if (disposed) return;
        setFile(f);
        setOriginal(f.content ?? "");
        setContent(f.content ?? "");
        if (["image", "pdf", "html"].includes(kind)) {
          const blob = await api.workspaceBlob(path);
          if (disposed) return;
          const mime =
            kind === "pdf"
              ? "application/pdf"
              : kind === "html"
                ? "text/html"
                : blob.type || `image/${path.split(".").pop()}`;
          url = URL.createObjectURL(new Blob([blob], { type: mime }));
          setBlobUrl(url);
        }
      })
      .catch((e: Error) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, revision, kind]);
  React.useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const current = await api.workspaceRead(path);
      if (current.content !== original) {
        setError("文件已在其他位置更新。请先复制当前修改，再重新加载文件。");
        return;
      }
      await api.workspaceWrite(path, content);
      setOriginal(content);
      toast.success("文件已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dsh-file-panel">
      <div className="dsh-panel-toolbar">
        <span className="dsh-path" title={path}>
          {path}
          {dirty ? " · 未保存" : ""}
        </span>
        <button
          type="button"
          className="dsh-icon-btn"
          onClick={() => void api.workspaceDownload(path).catch((e: Error) => toast.error(e.message))}
          aria-label="下载文件"
        >
          <IconDownload size={16} />
        </button>
        <button
          type="button"
          className="dsh-icon-btn"
          onClick={() => setRevision((r) => r + 1)}
          disabled={dirty}
          aria-label="重新加载文件"
        >
          <IconRefresh size={16} />
        </button>
        <button type="button" className="dsh-icon-btn" onClick={() => setRemove(true)} aria-label="删除文件">
          <IconTrash size={16} />
        </button>
      </div>
      <div className="dsh-view-tabs" role="tablist" aria-label="文件视图">
        {[
          ["preview", "预览"],
          ["source", "源文件"],
          ["diff", "变更"],
        ].map(([id, label]) => (
          <button type="button" role="tab" aria-selected={mode === id} key={id} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
        {dirty && (
          <button type="button" className="dsh-save-button" onClick={() => void save()} disabled={busy}>
            <IconDeviceFloppy size={15} />
            保存
          </button>
        )}
      </div>
      {error && (
        <div className="dsh-inline-error" role="alert">
          {error}
        </div>
      )}
      {!file && !error ? (
        <div className="dsh-panel-message" role="status">
          正在打开文件…
        </div>
      ) : (
        file && (
          <div className="dsh-file-content">
            {mode === "diff" ? (
              <pre className="dsh-diff">
                {lineChanges(original, content).map((row, i) => (
                  <div key={i} data-change={row.type}>
                    <span>{row.type === "add" ? "+" : row.type === "remove" ? "−" : " "}</span>
                    <span>{row.line}</span>
                    {row.text || " "}
                  </div>
                ))}
              </pre>
            ) : mode === "source" && !file.binary && !file.too_large ? (
              <textarea
                className="dsh-code-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                aria-label={`编辑 ${path}`}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
            ) : kind === "image" && blobUrl ? (
              <div className="dsh-image-preview">
                <img src={blobUrl} alt={path} />
              </div>
            ) : (kind === "pdf" || kind === "html") && blobUrl ? (
              <iframe
                title={path}
                src={blobUrl}
                sandbox={kind === "html" ? "" : "allow-same-origin"}
                className="dsh-document-frame"
              />
            ) : file.binary || file.too_large ? (
              <div className="dsh-panel-message">
                {file.too_large ? "文件较大，请下载后查看。" : "此文件格式请下载后打开。"}
                <button type="button" className="dsh-text-button" onClick={() => void api.workspaceDownload(path)}>
                  下载文件
                </button>
              </div>
            ) : kind === "markdown" ? (
              <div className="dsh-markdown-preview">
                <Markdown text={content} />
              </div>
            ) : kind === "table" ? (
              <div className="dsh-table-preview">
                <table>
                  <tbody>
                    {parseDelimited(content, path.endsWith(".tsv") ? "\t" : ",").map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <pre className="dsh-source-preview">{content}</pre>
            )}
          </div>
        )
      )}
      <Dialog open={remove} onOpenChange={setRemove}>
        <DialogContent>
          <DialogTitle>删除文件？</DialogTitle>
          <DialogDescription>{path}</DialogDescription>
          <div className="dsh-dialog-actions">
            <button type="button" onClick={() => setRemove(false)}>
              取消
            </button>
            <button
              type="button"
              className="dsh-danger-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.workspaceDelete(path);
                  wb.closeTab(`file:${path}`);
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              删除文件
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
