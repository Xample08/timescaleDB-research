import { ReactNode } from "react";

export default function StatCard({ title, value, subvalue, children }: { title: string; value: ReactNode; subvalue?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-1">
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      {subvalue && <div className="text-xs text-slate-500 dark:text-slate-400">{subvalue}</div>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
