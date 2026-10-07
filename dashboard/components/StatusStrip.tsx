'use client';
import { useEffect, useState } from 'react';
import { StatCard, Spinner } from './ui';
import { formatInt, formatDuration } from '@/lib/format';

export function StatusStrip() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: any;

    const fetchStatus = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/status');
        const json = await res.json();
        if (!mounted) return;
        if (res.ok) {
          setData(json);
          setError(null);
          setLastUpdate(new Date());
        } else {
          setError(json.error || 'Failed to fetch status');
        }
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message);
      }
    };

    fetchStatus();
    timer = setInterval(fetchStatus, 5000);

    const onVis = () => {
      if (!document.hidden) fetchStatus();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!data && !error) {
    return (
      <div className="h-24 flex items-center justify-center border-b border-slate-200 dark:border-slate-800">
        <Spinner />
      </div>
    );
  }

  const chunksCompressed = data?.chunks?.compressed || 0;
  const chunksTotal = data?.chunks?.total || 0;
  
  return (
    <div className="mb-4">
      <div className="flex justify-between items-end mb-2">
        <div className="text-xs text-slate-500">
          {error 
            ? <span className="text-red-500">Update failed: {error}</span> 
            : lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : ''}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="TimescaleDB version" value={data?.timescaleVersion || '—'} />
        <StatCard label="Rows (PostgreSQL)" value={data ? formatInt(data.approxRows.pg) : '—'} />
        <StatCard label="Rows (TimescaleDB)" value={data ? formatInt(data.approxRows.ts) : '—'} />
        <StatCard label="Chunks" value={`${chunksCompressed} / ${chunksTotal}`} hint="compressed / total" />
        <StatCard label="Ingest Rate" value={data ? `${formatInt(data.ingest.pgRowsPerSecond)} / ${formatInt(data.ingest.tsRowsPerSecond)}` : '—'} unit="rows/s" hint="pg / ts" />
        <StatCard label="Latest Row Age" value={data ? formatDuration(data.latest.ageSeconds) : '—'} />
      </div>
    </div>
  );
}
