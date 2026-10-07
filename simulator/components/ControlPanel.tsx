import React from "react";
import { Card, Field, Tabs, Button } from "./ui";

export type SimMode = "batch" | "per_row" | "burst";

export interface SimConfig {
  vehicles: number;
  interval: number;
  mode: SimMode;
  targets: string[];
  maxRows: number;
  maxMinutes: number;
  dirty: boolean;
}

interface Props {
  config: SimConfig;
  onChange: (cfg: SimConfig) => void;
  password: string;
  onPasswordChange: (p: string) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function ControlPanel({ config, onChange, password, onPasswordChange, isRunning, onStart, onStop }: Props) {
  const update = (key: keyof SimConfig, value: unknown) => {
    onChange({ ...config, [key]: value });
  };

  const applyPreset = (mode: SimMode, vehicles: number, interval: number) => {
    onChange({ ...config, mode, vehicles, interval });
  };

  // Validation
  const vErr = config.vehicles < 1 || config.vehicles > 1000 ? "1 to 1000" : (config.mode === "per_row" && config.vehicles > 50) ? "Max 50 in per_row" : "";
  const iErr = config.interval < 1 || config.interval > 60 ? "1 to 60" : "";
  const tErr = config.targets.length === 0 ? "Select at least one" : "";
  const rErr = config.maxRows < 1000 || config.maxRows > 5000000 ? "1k to 5M" : "";
  const mErr = config.maxMinutes < 1 || config.maxMinutes > 720 ? "1 to 720" : "";
  const canStart = !isRunning && !vErr && !iErr && !tErr && !rErr && !mErr && password.length > 0;

  return (
    <Card title="Controls">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <Button variant="secondary" disabled={isRunning} onClick={() => applyPreset("batch", 20, 5)} className="text-xs">Light</Button>
        <Button variant="secondary" disabled={isRunning} onClick={() => applyPreset("batch", 100, 2)} className="text-xs">Medium</Button>
        <Button variant="secondary" disabled={isRunning} onClick={() => applyPreset("batch", 500, 1)} className="text-xs">Heavy</Button>
        <Button variant="secondary" disabled={isRunning} onClick={() => applyPreset("burst", 100, 5)} className="text-xs">Burst</Button>
      </div>

      <Field label="Vehicles" error={vErr}>
        <input 
          type="number" 
          disabled={isRunning}
          className="h-9 rounded-md border px-2 text-sm w-full bg-transparent dark:border-slate-700" 
          value={config.vehicles} 
          onChange={e => update("vehicles", parseInt(e.target.value) || 0)} 
        />
      </Field>

      <Field label="Interval (s)" error={iErr}>
        <input 
          type="number" 
          disabled={isRunning || config.mode === "burst"}
          className="h-9 rounded-md border px-2 text-sm w-full bg-transparent dark:border-slate-700 disabled:opacity-50" 
          value={config.interval} 
          onChange={e => update("interval", parseInt(e.target.value) || 0)} 
        />
      </Field>

      <Field label="Mode">
        <Tabs 
          tabs={[{ id: "batch", label: "Batch" }, { id: "per_row", label: "Per Row" }, { id: "burst", label: "Burst" }]} 
          active={config.mode} 
          onChange={(id) => { if (!isRunning) update("mode", id as SimMode) }}
        />
      </Field>

      <Field label="Targets" error={tErr}>
        <div className="flex space-x-4 mt-1">
          <label className="flex items-center space-x-2 text-sm cursor-pointer">
            <input 
              type="checkbox" 
              disabled={isRunning}
              checked={config.targets.includes("pg")} 
              onChange={e => {
                const set = new Set(config.targets);
                if (e.target.checked) set.add("pg"); else set.delete("pg");
                update("targets", Array.from(set));
              }}
            />
            <span>PostgreSQL</span>
          </label>
          <label className="flex items-center space-x-2 text-sm cursor-pointer">
            <input 
              type="checkbox" 
              disabled={isRunning}
              checked={config.targets.includes("ts")} 
              onChange={e => {
                const set = new Set(config.targets);
                if (e.target.checked) set.add("ts"); else set.delete("ts");
                update("targets", Array.from(set));
              }}
            />
            <span>TimescaleDB</span>
          </label>
        </div>
      </Field>

      <Field label="Max rows per table" error={rErr}>
        <input 
          type="number" 
          disabled={isRunning}
          className="h-9 rounded-md border px-2 text-sm w-full bg-transparent dark:border-slate-700" 
          value={config.maxRows} 
          onChange={e => update("maxRows", parseInt(e.target.value) || 0)} 
        />
      </Field>

      <Field label="Max minutes" error={mErr}>
        <input 
          type="number" 
          disabled={isRunning}
          className="h-9 rounded-md border px-2 text-sm w-full bg-transparent dark:border-slate-700" 
          value={config.maxMinutes} 
          onChange={e => update("maxMinutes", parseInt(e.target.value) || 0)} 
        />
      </Field>

      <Field label="Dirty data (late & duplicate)">
        <label className="flex items-center space-x-2 text-sm mt-1 cursor-pointer">
          <input 
            type="checkbox" 
            disabled={isRunning}
            checked={config.dirty} 
            onChange={e => update("dirty", e.target.checked)}
          />
          <span>Enable dirty data</span>
        </label>
      </Field>

      <div className="pt-2 border-t border-slate-200 dark:border-slate-700 mt-2">
        <Field label="Password">
          <input 
            type="password" 
            disabled={isRunning}
            className="h-9 rounded-md border px-2 text-sm w-full bg-transparent dark:border-slate-700" 
            value={password} 
            onChange={e => onPasswordChange(e.target.value)} 
          />
        </Field>
      </div>

      <div className="flex space-x-2 mt-4">
        <Button variant="primary" className="flex-1" disabled={!canStart} onClick={onStart}>Start</Button>
        <Button variant="danger" className="flex-1" disabled={!isRunning} onClick={onStop}>Stop</Button>
      </div>
    </Card>
  );
}
