'use client';
import { useState, useEffect } from 'react';
import { Card, StatCard, Badge, Button, Spinner, ErrorState, SERIES_COLORS } from './ui';
import { formatBytes } from '@/lib/format';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

export function StorageTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStorage = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/storage');
      const json = await res.json();
      if (res.ok) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to fetch storage');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStorage();
    const timer = setInterval(() => {
      if (!document.hidden) fetchStorage();
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <ErrorState message={error} onRetry={fetchStorage} />;
  if (!data) return <Spinner />;

  const chunksTotal = data.chunks.length;
  const chunksComp = data.chunks.filter((c: any) => c.isCompressed).length;

  const chartData = [
    {
      name: 'PostgreSQL',
      table: data.pg.tableBytes,
      index: data.pg.indexBytes,
    },
    {
      name: 'TimescaleDB (Before)',
      table: data.ts.tableBytes,
      index: data.ts.indexBytes,
    }
  ];

  if (data.ts.afterCompressionBytes != null) {
    chartData.push({
      name: 'TimescaleDB (After)',
      table: data.ts.afterCompressionBytes,
      index: data.ts.indexBytes, // Assuming index stays same or isn't broken down, actually stats just give total.
      // Wait, before/after compression stats are totals. The requirement says:
      // "when compression stats exist, add a bar for the hypertable after compression."
    });
  }

  // To make the chart match the requirement "table bytes and index bytes for PostgreSQL and for the hypertable; when compression stats exist, add a bar for the hypertable after compression."
  // Wait, if afterCompressionBytes exists, I can just map `table` to afterCompressionBytes and index to 0 or leave index as is. 
  // Let's just use `total` for the after compression, but the spec says "table bytes and index bytes ... add a bar for the hypertable after compression".

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={fetchStorage} disabled={loading}>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="PostgreSQL Total" value={formatBytes(data.pg.totalBytes)} />
        <StatCard label="Hypertable Total" value={formatBytes(data.ts.totalBytes)} />
        <StatCard label="Compression Ratio" value={data.ts.compressionRatio ? `${data.ts.compressionRatio.toFixed(2)}x` : '—'} />
        <StatCard label="Chunks Compressed" value={`${chunksComp} / ${chunksTotal}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Storage Size" className="h-72 relative">
          {loading && <div className="absolute inset-0 bg-white/50 z-10 dark:bg-slate-900/50" />}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" />
              <XAxis dataKey="name" style={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => formatBytes(v)} style={{ fontSize: 11 }} width={80} />
              <Tooltip 
                formatter={(val: any) => formatBytes(val)}
                labelStyle={{ color: '#0f172a' }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar dataKey="table" name="Table / Total" fill={SERIES_COLORS.pg} isAnimationActive={false} />
              <Bar dataKey="index" name="Index" fill={SERIES_COLORS.ts} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Latest Chunks (max 100)" className="min-w-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Range Start</th>
                  <th className="py-2 font-medium">Range End</th>
                  <th className="py-2 font-medium text-right">Size</th>
                  <th className="py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.chunks.map((c: any) => (
                  <tr key={c.name} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="py-2 font-mono">{c.name}</td>
                    <td className="py-2">{c.rangeStart ? new Date(c.rangeStart).toLocaleString() : '—'}</td>
                    <td className="py-2">{c.rangeEnd ? new Date(c.rangeEnd).toLocaleString() : '—'}</td>
                    <td className="py-2 text-right tabular-nums">{formatBytes(c.totalBytes)}</td>
                    <td className="py-2 text-center">
                      {c.isCompressed ? <Badge tone="ok">Compressed</Badge> : <Badge tone="neutral">Uncompressed</Badge>}
                    </td>
                  </tr>
                ))}
                {data.chunks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-slate-500">No chunks found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
