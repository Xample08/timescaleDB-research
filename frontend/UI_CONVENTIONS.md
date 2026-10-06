# UI Conventions

- **Page Layout**: `max-w-6xl` centered wrapper (`App.tsx`), with top header, border-bottom navigation, `HealthStatus` block, then `<main>` content.
- **Spacing Scale**: Follows standard Tailwind classes. Gaps are typically `gap-4` or `gap-6` for grid layouts. Padding is `p-6` or `p-8` for cards.
- **Colors for PG vs TS**: PostgreSQL uses standard blue (`#3b82f6` / `blue-500`), TimescaleDB uses standard orange/amber (`#f59e0b` / `amber-500`) in charts. `ts_cagg` uses emerald (`#10b981` / `emerald-500`).
- **Card Style**: `.rounded-xl.border.border-slate-200.bg-white.shadow-sm` in light mode, and dark mode variants (`dark:border-slate-800 dark:bg-slate-900`).
- **Typography**: `Inter` for sans-serif UI, `JetBrains Mono` for monospace data (via `index.css`). Subtitles use `text-slate-500`.
- **Chart Style**: `Recharts` with `#1e293b` tooltip background for dark mode consistency. Lines are thickness `2` with `isAnimationActive={false}`.

## Shared Components

- `PageHeader`: `title` and `description` heading for pages.
- `StatCard`: Standard metric card (`title`, `value`, `subvalue`).
- `LoadingState`: Spinning loader for async states.
- `ErrorState`: Friendly error box with optional `onRetry` button.
- `EmptyState`: Dashed border placeholder message.
