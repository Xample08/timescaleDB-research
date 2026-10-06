import { useState, useEffect } from "react";
import HealthStatus from "./components/HealthStatus";
import Simulation from "./pages/Simulation";
import Vehicles from "./pages/Vehicles";
import Benchmark from "./pages/Benchmark";
import Storage from "./pages/Storage";
import Learn from "./pages/Learn";

function useHashLocation() {
  const [loc, setLoc] = useState(window.location.hash || "#/");
  useEffect(() => {
    const handler = () => setLoc(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return loc.replace(/^#/, "");
}

export default function App() {
  const path = useHashLocation();
  
  let page = <Simulation />;
  if (path === "/vehicles") page = <Vehicles />;
  if (path === "/benchmark") page = <Benchmark />;
  if (path === "/storage") page = <Storage />;
  if (path === "/learn") page = <Learn />;

  const navLinks = [
    { name: "Simulation", path: "/" },
    { name: "Vehicles", path: "/vehicles" },
    { name: "Benchmark", path: "/benchmark" },
    { name: "Storage", path: "/storage" },
    { name: "Learn", path: "/learn" },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-violet-500 text-lg font-bold text-white shadow-lg shadow-brand-500/30">
          ⏱
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vehicle Tracking Demo</h1>
          <p className="text-sm text-slate-500">TimescaleDB vs PostgreSQL</p>
        </div>
      </header>

      <nav className="mb-8 border-b border-slate-200 dark:border-slate-800">
        <ul className="flex flex-wrap gap-6 text-sm font-medium">
          {navLinks.map((link) => {
            const isActive = path === link.path;
            return (
              <li key={link.path}>
                <a
                  href={`#${link.path}`}
                  className={`inline-block border-b-2 pb-3 transition-colors ${
                    isActive
                      ? "border-brand-500 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                      : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  {link.name}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mb-8">
        <HealthStatus />
      </div>

      <main className="flex-1">{page}</main>

      <footer className="mt-10 text-center text-xs text-slate-500">
        Phase 2 · Simulation Page
      </footer>
    </div>
  );
}
