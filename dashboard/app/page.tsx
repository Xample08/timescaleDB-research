"use client";
import { useEffect, useState } from "react";
import { AppNavigation } from "@/components/AppNavigation";
import { Icon } from "@/components/Icon";
import { ResizablePanels } from "@/components/ResizablePanels";
import {
  SqlExecutionProvider,
  SqlExecutionView,
} from "@/components/SqlExecution";
import { StatusStrip } from "@/components/StatusStrip";
import { BenchmarkTab } from "@/components/BenchmarkTab";
import { ProbeTab } from "@/components/ProbeTab";
import { WarningsTab } from "@/components/WarningsTab";
import { StorageTab } from "@/components/StorageTab";
import { DEFAULT_LAYOUT } from "@/lib/layout";
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("Warnings");
  const [layoutVersion, setLayoutVersion] = useState(0);
  useEffect(() => {
    const read = () => {
      const tabs: Record<string, string> = {
        benchmark: "Benchmark",
        "live-probe": "Live Probe",
        storage: "Storage",
        warnings: "Warnings",
      };
      setActiveTab(tabs[window.location.hash.slice(1)] || "Warnings");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return (
    <SqlExecutionProvider>
      <main className="dashboard-shell">
        <header className="topbar">
          <a href="#dashboard" className="brand">
            <span className="brand-mark">
              <Icon name="bolt" />
            </span>
            <span>
              Telemetry Lab<small>DATABASE RESEARCH</small>
            </span>
          </a>
          <AppNavigation section="comparison" active={activeTab} />
          <span className="topbar-caption">
            PostgreSQL <span>vs</span> TimescaleDB
          </span>
        </header>
        <div className="page-heading" id="dashboard">
          <div>
            <p className="eyebrow">DATABASE COMPARISON WORKSPACE</p>
            <h1>
              {activeTab}
              <span> / </span>
              <small>
                {activeTab === "Benchmark"
                  ? "Compare every query."
                  : activeTab === "Live Probe"
                    ? "Watch live response times."
                    : activeTab === "Warnings"
                      ? "Inspect abnormal telemetry."
                      : "Understand your storage."}
              </small>
            </h1>
          </div>
          <div className="layout-actions">
            <button
              className="reset-layout"
              onClick={() => setLayoutVersion((v) => v + 1)}
            >
              Reset sizes
            </button>
            <span className="database-key pg">
              <Icon name="database" />
              PostgreSQL
            </span>
            <span className="database-key ts">
              <Icon name="bolt" />
              TimescaleDB
            </span>
          </div>
        </div>
        <StatusStrip />
        <ResizablePanels
          key={layoutVersion}
          className="dashboard-workspace"
          label="Dashboard columns"
          initialSizes={DEFAULT_LAYOUT.workspace}
        >
          <div className="dashboard-content">
            {activeTab === "Benchmark" && <BenchmarkTab />}
            {activeTab === "Live Probe" && <ProbeTab />}
            {activeTab === "Storage" && <StorageTab />}
            {activeTab === "Warnings" && <WarningsTab />}
          </div>
          <SqlExecutionView source={activeTab} />
        </ResizablePanels>
      </main>
    </SqlExecutionProvider>
  );
}
