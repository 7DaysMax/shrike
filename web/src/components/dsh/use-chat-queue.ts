"use client";
import * as React from "react";
import { api } from "@/lib/api";
import type { ChatAttachment } from "@/lib/types";
interface QueuedMessage {
  id: string;
  message: string;
  attachments: ChatAttachment[];
  state: "waiting" | "sending" | "error";
  error?: string;
}
function parse(raw: string | null): QueuedMessage[] {
  try {
    const data = JSON.parse(raw ?? "[]");
    return Array.isArray(data)
      ? data.filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.message === "string" &&
            Array.isArray(item.attachments) &&
            ["waiting", "sending", "error"].includes(item.state),
        )
      : [];
  } catch {
    return [];
  }
}
export function useChatQueue(id: number, canSend: boolean, onSent: () => void, options?:{namespace?:string;send?:(message:string,attachments:ChatAttachment[])=>Promise<unknown>}) {
  const sendRef=React.useRef(options?.send);sendRef.current=options?.send;
  const key = `artex.dsh.queue.${options?.namespace??id}`;
  const [queue, setQueue] = React.useState<QueuedMessage[]>([]);
  const [ready, setReady] = React.useState(false);
  const memory = React.useRef<QueuedMessage[]>([]);
  const storage = React.useRef(true);
  const onSentRef = React.useRef(onSent);
  onSentRef.current = onSent;
  const read = React.useCallback(() => {
    if (!storage.current) return memory.current;
    try {
      return parse(localStorage.getItem(key));
    } catch {
      storage.current = false;
      return memory.current;
    }
  }, [key]);
  const commit = React.useCallback(
    (items: QueuedMessage[]) => {
      memory.current = items;
      try {
        localStorage.setItem(key, JSON.stringify(items));
      } catch {
        storage.current = false;
      }
      setQueue(items);
    },
    [key],
  );
  React.useEffect(() => {
    let disposed = false;
    async function restore() {
      let activeSender = false;
      if (navigator.locks) {
        try {
          activeSender = (await navigator.locks.query()).held?.some((lock) => lock.name === key) ?? false;
        } catch {
          /* Without a lock snapshot, interrupted sends require explicit review. */
        }
      }
      if (disposed) return;
      commit(
        read().map((item) =>
          item.state === "sending" && !activeSender
            ? { ...item, state: "error", error: "上次发送结果待确认，请检查会话记录后重试。" }
            : item,
        ),
      );
      setReady(true);
    }
    void restore();
    const sync = (event: StorageEvent) => {
      if (event.key === key) {
        const items = read();
        memory.current = items;
        setQueue(items);
      }
    };
    window.addEventListener("storage", sync);
    return () => {
      disposed = true;
      window.removeEventListener("storage", sync);
    };
  }, [key, read, commit]);
  const first = queue[0];
  React.useEffect(() => {
    if (!ready || !canSend || !first || first.state !== "waiting") return;
    let disposed = false;
    const send = async () => {
      if (disposed) return;
      const current = read();
      if (current[0]?.id !== first.id || current[0]?.state !== "waiting") {
        memory.current = current;
        setQueue(current);
        return;
      }
      commit(current.map((item, i) => (i === 0 ? { ...item, state: "sending" } : item)));
      try {
        if(sendRef.current)await sendRef.current(first.message,first.attachments);
        else await api.sendConversationMessage(id, first.message, first.attachments.length ? first.attachments : undefined);
        onSentRef.current();
        commit(read().filter((item) => item.id !== first.id));
      } catch (e) {
        commit(
          read().map((item) =>
            item.id === first.id ? { ...item, state: "error", error: (e as Error).message } : item,
          ),
        );
      }
    };
    if (navigator.locks) void navigator.locks.request(key, send);
    else void send();
    return () => {
      disposed = true;
    };
  }, [id, key, first, ready, canSend, read, commit]);
  const enqueue = React.useCallback(
    (message: string, attachments: ChatAttachment[]) =>
      commit([...read(), { id: crypto.randomUUID(), message, attachments, state: "waiting" }]),
    [read, commit],
  );
  return {
    queue,
    enqueue,
    remove: (target: string) => commit(read().filter((item) => item.id !== target)),
    retry: (target: string) =>
      commit(read().map((item) => (item.id === target ? { ...item, state: "waiting", error: undefined } : item))),
  };
}
