"use client";
import { useEffect, useRef } from "react";
const comparison = [
  ["Benchmark", "benchmark"],
  ["Live Probe", "live-probe"],
  ["Storage", "storage"],
  ["Warnings", "warnings"],
] as const;
export function AppNavigation({
  section,
  active,
}: {
  section: "reports" | "comparison";
  active: string;
}) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        nav.current?.contains(event.target as Node)
      )
        return;
      nav.current?.querySelectorAll("details").forEach((details) => {
        details.open = false;
      });
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const closeMenus = () =>
    nav.current?.querySelectorAll("details").forEach((details) => {
      details.open = false;
    });
  return (
    <nav ref={nav} className="app-navigation" aria-label="Main navigation">
      <details
        name="app-navigation"
        className={section === "reports" ? "active-group" : ""}
      >
        <summary>
          Reports <span aria-hidden="true">⌄</span>
        </summary>
        <div className="nav-children">
          <p>Individual fleet dashboards</p>
          <a
            href="/reports#pg"
            onClick={closeMenus}
            className="nav-pg"
            aria-current={
              section === "reports" && active === "pg" ? "page" : undefined
            }
          >
            <span className="nav-dot" />
            PostgreSQL
          </a>
          <a
            href="/reports#ts"
            onClick={closeMenus}
            className="nav-ts"
            aria-current={
              section === "reports" && active === "ts" ? "page" : undefined
            }
          >
            <span className="nav-dot" />
            TimescaleDB
          </a>
        </div>
      </details>
      <details
        name="app-navigation"
        className={section === "comparison" ? "active-group" : ""}
      >
        <summary>
          Benchmark & Compare <span aria-hidden="true">⌄</span>
        </summary>
        <div className="nav-children">
          <p>Database research workspace</p>
          {comparison.map(([label, hash]) => (
            <a
              key={hash}
              href={`/#${hash}`}
              onClick={closeMenus}
              aria-current={
                section === "comparison" && active === label
                  ? "page"
                  : undefined
              }
            >
              {label}
            </a>
          ))}
        </div>
      </details>
    </nav>
  );
}
