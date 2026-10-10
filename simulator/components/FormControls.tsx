import React from "react";
import { InfoTip } from "./InfoTip";
import { Icon } from "./Icon";

export function NumberField({
  id,
  label,
  placeholder,
  help,
  value,
  min,
  max,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  help?: string;
  value: number;
  min: number;
  max?: number;
  disabled?: boolean;
  error?: string;
  onChange: (value: number) => void;
}) {
  const step = (direction: number) =>
    onChange(
      Math.min(
        max ?? Infinity,
        Math.max(
          min,
          (Number.isFinite(value) ? value : min - (direction > 0 ? 1 : 0)) +
            direction,
        ),
      ),
    );
  return (
    <div className={`number-field ${disabled ? "is-disabled" : ""}`}>
      <div className="floating-field">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step="1"
          placeholder={placeholder}
          disabled={disabled}
          value={Number.isNaN(value) ? "" : value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) =>
            onChange(e.target.value === "" ? NaN : Number(e.target.value))
          }
        />
        <label htmlFor={id} title={label}>
          {label}
        </label>
        {help && <InfoTip label={label} text={help} />}
        <div className="number-stepper">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || (max !== undefined && value >= max)}
            aria-label={`Increase ${label}`}
            onClick={() => step(1)}
          >
            +
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || value <= min}
            aria-label={`Decrease ${label}`}
            onClick={() => step(-1)}
          >
            -
          </button>
        </div>
      </div>
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function Checkbox({
  checked,
  disabled,
  onChange,
  children,
  className = "",
  help,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
  help?: string;
}) {
  return (
    <div className="checkbox-with-help">
      <label
        className={`custom-checkbox ${className} ${disabled ? "is-disabled" : ""}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="checkbox-box">
          <Icon name="check" />
        </span>
        <span>{children}</span>
      </label>
      {help && (
        <InfoTip
          label={typeof children === "string" ? children : "this option"}
          text={help}
        />
      )}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const safeValue = Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : min;
  return (
    <input
      className="custom-slider"
      aria-label="Vehicle count slider"
      type="range"
      min={min}
      max={max}
      step="1"
      value={safeValue}
      disabled={disabled}
      style={
        {
          "--slider-fill": `${((safeValue - min) / (max - min)) * 100}%`,
        } as React.CSSProperties
      }
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
