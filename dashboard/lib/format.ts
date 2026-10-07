export function formatMs(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${n.toFixed(2)} ms`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "0.00 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  if (i === 0) return `${n} ${sizes[i]}`;
  return `${(n / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) {
    const mins = m % 60;
    return `${h}h ${mins < 10 ? "0" : ""}${mins}m`;
  }
  const secs = s % 60;
  return `${m}m ${secs < 10 ? "0" : ""}${secs}s`;
}
