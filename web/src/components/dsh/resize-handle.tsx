"use client";
import type * as React from "react";

export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  side = "left",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  side?: "left" | "right";
}) {
  function start(e: React.PointerEvent<HTMLHRElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget,
      initial = e.clientX,
      width = value;
    const update = (event: PointerEvent) =>
      onChange(Math.max(min, Math.min(max, width + (event.clientX - initial) * (side === "left" ? 1 : -1))));
    const end = () => {
      target.removeEventListener("pointermove", update);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", update);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
  return (
    <hr
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      tabIndex={0}
      className={`dsh-resizer dsh-resizer-${side}`}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        onChange(
          e.key === "Home"
            ? min
            : e.key === "End"
              ? max
              : Math.max(min, Math.min(max, value + (e.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1))),
        );
      }}
    />
  );
}
