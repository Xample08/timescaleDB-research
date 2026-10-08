"use client";
import React, { useId, useLayoutEffect, useRef, useState } from "react";
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || !button.current || !popup.current) return;
    const trigger = button.current;
    const panel = popup.current;
    const ancestors: HTMLElement[] = [];
    for (
      let parent = trigger.parentElement;
      parent;
      parent = parent.parentElement
    )
      ancestors.push(parent);
    const position = () => {
      const box = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const rightEdge = leftEdge + (viewport?.width || window.innerWidth);
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight);
      // Dismiss when the icon scrolls out of view instead of leaving detached help.
      const clipped =
        box.bottom <= topEdge ||
        box.top >= bottomEdge ||
        box.right <= leftEdge ||
        box.left >= rightEdge ||
        ancestors.some((parent) => {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          return (
            (/(auto|scroll|hidden|clip)/.test(style.overflowY) &&
              (box.bottom <= bounds.top || box.top >= bounds.bottom)) ||
            (/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
              (box.right <= bounds.left || box.left >= bounds.right))
          );
        });
      if (clipped) {
        panel.hidePopover();
        return;
      }
      panel.style.maxHeight = `${Math.max(40, bottomEdge - topEdge - 24)}px`;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = Math.max(
        leftEdge + 12,
        Math.min(box.left, rightEdge - width - 12),
      );
      const below = box.bottom + 8;
      const above = box.top - height - 8;
      const top =
        below + height <= bottomEdge - 12
          ? below
          : above >= topEdge + 12
            ? above
            : Math.max(topEdge + 12, bottomEdge - height - 12);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    position();
    // Capture scroll events from nested panes as well as the document.
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    window.visualViewport?.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(panel);
    ancestors.forEach((parent) => observer.observe(parent));
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      window.visualViewport?.removeEventListener("resize", position);
      observer.disconnect();
    };
  }, [open]);
  return (
    <span className="info-tip">
      <button
        ref={button}
        type="button"
        className="info-button"
        aria-label={`About ${label}`}
        title={text}
        popoverTarget={id}
      >
        i
      </button>
      <span
        ref={popup}
        id={id}
        popover="auto"
        className="info-popup"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <strong>{label}</strong>
        <span>{text}</span>
      </span>
    </span>
  );
}
