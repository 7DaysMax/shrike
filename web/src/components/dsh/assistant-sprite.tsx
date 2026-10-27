"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
export function AssistantSprite({
  state = "idle",
  intensity = 0.4,
}: {
  state?: "idle" | "thinking" | "working";
  intensity?: number;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    const update = () => setForeground(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (element.current) observer?.observe(element.current);
    return () => {
      document.removeEventListener("visibilitychange", update);
      observer?.disconnect();
    };
  }, []);
  const speed = 1.2 - Math.min(1, Math.max(0, intensity)) * 0.7;
  return (
    <span
      ref={element}
      className="artex-assistant"
      data-paused={!visible || !foreground || undefined}
      data-state={state}
      aria-hidden="true"
      style={{ "--assistant-tempo": `${speed}s` } as CSSProperties}
    >
      <svg aria-hidden="true" viewBox="0 0 64 72" fill="none" focusable="false">
        <ellipse className="assistant-shadow" cx="32" cy="67" rx="14" ry="3" fill="currentColor" opacity=".12" />
        <g className="assistant-body">
          <path
            className="assistant-leg assistant-leg-left"
            d="M26 50v10l-7 3"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            className="assistant-leg assistant-leg-right"
            d="M38 50v10l7 3"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M21 35c0-6 22-6 22 0v16c-8 5-14 5-22 0V35Z"
            fill="var(--dsw-alias-bg-base)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <path
            className="assistant-arm assistant-arm-left"
            d="M21 36 14 45 10 42"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            className="assistant-arm assistant-arm-right"
            d="m43 36 7 8 4-6"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <rect
            x="14"
            y="8"
            width="36"
            height="27"
            rx="11"
            fill="var(--dsw-alias-bg-base)"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <rect x="19" y="15" width="26" height="13" rx="6" fill="currentColor" opacity=".13" />
          <g className="assistant-eyes" fill="currentColor">
            <rect x="24" y="18" width="3" height="6" rx="1.5" />
            <rect x="37" y="18" width="3" height="6" rx="1.5" />
          </g>
          <path d="M29 27h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M32 8V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="3" r="2.5" fill="currentColor" />
          <path d="m25 39 7 4 7-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
    </span>
  );
}
