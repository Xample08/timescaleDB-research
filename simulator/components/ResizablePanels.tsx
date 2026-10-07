"use client";
import React, { useRef, useState } from "react";
export function ResizablePanels({
  children,
  direction = "horizontal",
  initialSizes,
  label,
  className = "",
}: {
  children: React.ReactNode[];
  direction?: "horizontal" | "vertical";
  initialSizes?: number[];
  label: string;
  className?: string;
}) {
  const [sizes, setSizes] = useState(
    initialSizes || children.map(() => 100 / children.length),
  );
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    index: number;
    start: number;
    extent: number;
    sizes: number[];
  } | null>(null);
  const horizontal = direction === "horizontal";
  const resize = (index: number, change: number, original = sizes) => {
    const next = original.slice();
    const total = next[index] + next[index + 1];
    const minimum = Math.min(10, total / 3);
    next[index] = Math.max(
      minimum,
      Math.min(total - minimum, next[index] + change),
    );
    next[index + 1] = total - next[index];
    setSizes(next);
  };
  const tracks = sizes
    .flatMap((size, index) =>
      index === sizes.length - 1
        ? [`minmax(0, ${size}fr)`]
        : [`minmax(0, ${size}fr)`, "12px"],
    )
    .join(" ");
  return (
    <div
      ref={container}
      className={`resizable-panels ${direction} ${className}`}
      style={
        horizontal
          ? { gridTemplateColumns: tracks }
          : { gridTemplateRows: tracks }
      }
    >
      {children.map((child, index) => (
        <React.Fragment key={index}>
          <div className="resizable-pane">{child}</div>
          {index < children.length - 1 && (
            <div
              className="resize-divider"
              role="separator"
              tabIndex={0}
              aria-label={`${label}: resize panels ${index + 1} and ${index + 2}`}
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              aria-valuenow={Math.round(sizes[index])}
              aria-valuemin={0}
              aria-valuemax={100}
              onPointerDown={(e) => {
                const bounds = container.current?.getBoundingClientRect();
                if (!bounds) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  index,
                  start: horizontal ? e.clientX : e.clientY,
                  extent: horizontal ? bounds.width : bounds.height,
                  sizes: sizes.slice(),
                };
              }}
              onPointerMove={(e) => {
                const current = drag.current;
                if (current)
                  resize(
                    current.index,
                    (((horizontal ? e.clientX : e.clientY) - current.start) /
                      current.extent) *
                      100,
                    current.sizes,
                  );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                const decrease = horizontal ? "ArrowLeft" : "ArrowUp";
                const increase = horizontal ? "ArrowRight" : "ArrowDown";
                if (e.key === decrease || e.key === increase) {
                  e.preventDefault();
                  resize(index, e.key === decrease ? -2 : 2);
                }
              }}
            >
              <span />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
