"use client";
import * as React from "react";
/** Drafts are local UI state. A submitted message still goes through the existing API. */
export function useChatDraft(key: string, initial = "") {
  const [value, setValue] = React.useState(initial),
    [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    try {
      if (!initial) setValue(localStorage.getItem(`artex.dsh.draft.${key}`) ?? "");
    } catch {
      /* Draft storage is optional. */
    }
    setReady(true);
  }, [key, initial]);
  React.useEffect(() => {
    if (!ready) return;
    try {
      if (value) localStorage.setItem(`artex.dsh.draft.${key}`, value);
      else localStorage.removeItem(`artex.dsh.draft.${key}`);
    } catch {
      /* Keep the draft in memory when storage is full. */
    }
  }, [key, value, ready]);
  return [value, setValue] as const;
}
