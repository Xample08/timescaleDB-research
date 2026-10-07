import React, { useState } from "react";
import { NumberField, Checkbox, Slider } from "./FormControls";
import { Icon } from "./Icon";
import { Button, Tabs } from "./ui";
import { SimConfig, validateConfig } from "../lib/config";
export { validateConfig } from "../lib/config";
export type { SimMode, SimConfig } from "../lib/config";
interface Props {
  config: SimConfig;
  onChange: (c: SimConfig) => void;
  password: string;
  onPasswordChange: (p: string) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}
export function ControlPanel({
  config,
  onChange,
  password,
  onPasswordChange,
  isRunning,
  onStart,
  onStop,
}: Props) {
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validateConfig(config) : {};
  const update = (key: keyof SimConfig, value: unknown) =>
    onChange({ ...config, [key]: value });
  const numberInput = (
    key: "vehicles" | "interval" | "maxRows" | "maxMinutes",
    label: string,
    min: number,
    max: number,
  ) => (
    <NumberField
      id={`sim-${key}`}
      label={label}
      placeholder={
        key === "vehicles"
          ? "Count"
          : `${min.toLocaleString()} - ${max.toLocaleString()}`
      }
      min={min}
      max={max}
      disabled={isRunning || (key === "interval" && config.mode === "burst")}
      value={config[key]}
      error={errors[key]}
      onChange={(value) => update(key, value)}
    />
  );

  return (
    <section className="controls panel" aria-label="Simulation controls">
      <div className="section-title">
        <span className="section-icon">
          <Icon name="settings" />
        </span>
        <div>
          <h2>Configure your run</h2>
          <p>One fleet. Two databases.</p>
        </div>
      </div>
      <div className="presets">
        {(
          [
            ["Light", 20, 5, "batch"],
            ["Medium", 100, 2, "batch"],
            ["Heavy", 500, 1, "batch"],
            ["Burst", 100, 5, "burst"],
          ] as const
        ).map(([label, vehicles, interval, mode]) => (
          <button
            key={label}
            disabled={isRunning}
            onClick={() => onChange({ ...config, vehicles, interval, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="vehicle-control">
        <span className="field-caption">
          Fleet size{" "}
          <small>1 to {config.mode === "per_row" ? 50 : 1000} vehicles</small>
        </span>
        <div className="slider-row">
          <Slider
            value={config.vehicles}
            min={1}
            max={config.mode === "per_row" ? 50 : 1000}
            disabled={isRunning}
            onChange={(value) => update("vehicles", value)}
          />
          {numberInput(
            "vehicles",
            "Vehicles",
            1,
            config.mode === "per_row" ? 50 : 1000,
          )}
        </div>
      </div>
      <div>
        <span className="field-caption">Insert strategy</span>
        <Tabs
          tabs={[
            { id: "batch", label: "Batch" },
            { id: "per_row", label: "Per row" },
            { id: "burst", label: "Burst" },
          ]}
          active={config.mode}
          onChange={(id) => {
            if (!isRunning) update("mode", id);
          }}
        />
        <p className="helper">
          {config.mode === "batch"
            ? "Group records into batches of up to 500."
            : config.mode === "burst"
              ? "Insert batches continuously, without waiting."
              : "Execute one INSERT for each vehicle."}
        </p>
      </div>
      <div>
        <span className="field-caption">Write destinations</span>
        <div className="target-options">
          {["pg", "ts"].map((t) => (
            <Checkbox
              key={t}
              className={`target ${t}`}
              checked={config.targets.includes(t)}
              disabled={isRunning}
              onChange={(checked) =>
                update(
                  "targets",
                  checked
                    ? [...config.targets, t]
                    : config.targets.filter((v) => v !== t),
                )
              }
            >
              {t === "pg" ? "PostgreSQL" : "TimescaleDB"}
            </Checkbox>
          ))}
        </div>
        {errors.targets && (
          <small className="field-error" role="alert">
            {errors.targets}
          </small>
        )}
      </div>
      <div className="input-grid">
        {numberInput("interval", "Interval (s)", 1, 60)}
        {numberInput("maxMinutes", "Time limit (min)", 1, 720)}
      </div>
      {numberInput("maxRows", "Row limit (per database)", 1000, 5000000)}
      <Checkbox
        className="dirty-toggle"
        checked={config.dirty}
        disabled={isRunning}
        onChange={(checked) => update("dirty", checked)}
      >
        Include late & duplicate records
      </Checkbox>
      <div className="password-field">
        <div className="floating-field">
          <input
            id="sim-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter simulator password"
            disabled={isRunning}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            aria-invalid={submitted && !password}
            aria-describedby={
              submitted && !password ? "password-error" : undefined
            }
          />
          <label htmlFor="sim-password">Access password</label>
        </div>
        {submitted && !password && (
          <small id="password-error" className="field-error" role="alert">
            Enter your password to run.
          </small>
        )}
      </div>
      <div className="run-actions">
        <Button
          variant="primary"
          disabled={isRunning}
          onClick={() => {
            setSubmitted(true);
            if (!Object.keys(validateConfig(config)).length && password)
              onStart();
          }}
        >
          <Icon name="play" /> Run simulation
        </Button>
        <Button variant="secondary" disabled={!isRunning} onClick={onStop}>
          <Icon name="stop" /> Stop
        </Button>
      </div>
    </section>
  );
}
