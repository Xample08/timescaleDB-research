'use client';
import { useState, useEffect, useRef } from 'react';
import { Card, Field, Button, SERIES_COLORS, StatCard, EmptyState, ErrorState } from './ui';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { formatMs, formatInt } from '@/lib/format';
import { percentile } from '@/lib/bench';

type DataPoint = { time: number; pg: number; ts: number; ingestRate: number };

export function ProbeTab() {
  const [running, setRunning] = useState(false);
  const [queryId, setQueryId] = useState('B1');
  const [vehicleId, setVehicleId] = useState('1');
  const [intervalSec, setIntervalSec] = useState('2');
  const [data, setData] = useState<DataPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const [ingestRate, setIngestRate] = useState(0);

  const toggleOrderRef = useRef(false);

  // Poll status for ingest rate independently
  useEffect(() => {
    let mounted = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        const st = await res.json();
        if (mounted && res.ok) {
          setIngestRate(st.ingest.pgRowsPerSecond);
        }
      } catch {}
    };
    if (running) {
      fetchStatus();
      const t = setInterval(fetchStatus, 5000);
      return () => { mounted = false; clearInterval(t); };
    }
  }, [running]);

  useEffect(() => {
    let mounted = true;
    let timer: any = null;

    const tick = async () => {
      if (document.hidden) {
        setRunning(false);
        return;
      }

      const order = toggleOrderRef.current;
      toggleOrderRef.current = !order;
      const variants = order ? ['ts', 'pg'] : ['pg', 'ts'];

      try {
        const res = await fetch('/api/benchmark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queryId,
            variants,
            vehicleId: vehicleId ? parseInt(vehicleId, 10) : null
          })
        });
        const json = await res.json();
        if (!mounted) return;
        
        if (!res.ok) {
          setError(json.error);
          setRunning(false);
          return;
        }
        
        const pt: DataPoint = { time: Date.now(), pg: 0, ts: 0, ingestRate };
        for (const r of json.results) {
          if (r.error) {
            setError(r.error);
            setRunning(false);
            return;
          }
          if (r.variant === 'pg') pt.pg = r.executionMs;
          if (r.variant === 'ts') pt.ts = r.executionMs;
        }

        setData(prev => {
          const next = [...prev, pt];
          if (next.length > 120) return next.slice(next.length - 120);
          return next;
        });
        setError(null);
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message);
        setRunning(false);
      }
    };

    if (running) {
      tick();
      timer = setInterval(tick, parseInt(intervalSec, 10) * 1000);
    }
    
    const onVis = () => { if (document.hidden) setRunning(false); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [running, queryId, vehicleId, intervalSec, ingestRate]);

  const lastPt = data.length > 0 ? data[data.length - 1] : null;
  const pgArr = data.map(d => d.pg);
  const tsArr = data.map(d => d.ts);
  const pgMed = pgArr.length > 0 ? percentile(pgArr, 50) : 0;
  const tsMed = tsArr.length > 0 ? percentile(tsArr, 50) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card title="Probe Settings" className="xl:sticky xl:top-4 xl:self-start">
        <Field label="Query">
          <select disabled={running} className="h-9 rounded-md border px-2 text-sm" value={queryId} onChange={e => setQueryId(e.target.value)}>
            <option value="B1">B1: Latest position</option>
            <option value="B2">B2: One vehicle route, 1h</option>
            <option value="B5">B5: Fleet activity, 15m</option>
          </select>
        </Field>
        <Field label="Vehicle ID (for B2)">
          <input type="number" disabled={running} className="h-9 rounded-md border px-2 text-sm" value={vehicleId} onChange={e => setVehicleId(e.target.value)} />
        </Field>
        <Field label="Interval (s)">
          <select disabled={running} className="h-9 rounded-md border px-2 text-sm" value={intervalSec} onChange={e => setIntervalSec(e.target.value)}>
            <option value="2">2 s</option>
            <option value="3">3 s</option>
            <option value="5">5 s</option>
            <option value="10">10 s</option>
          </select>
        </Field>
        <div className="pt-2">
          {!running ? (
            <Button variant="primary" className="w-full" onClick={() => { setData([]); setError(null); setRunning(true); }}>Start</Button>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => setRunning(false)}>Stop</Button>
          )}
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {error && <ErrorState message={error} />}
        
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Last pg ms" value={lastPt ? formatMs(lastPt.pg) : '—'} />
          <StatCard label="Last ts ms" value={lastPt ? formatMs(lastPt.ts) : '—'} />
          <StatCard label="Median pg ms" value={pgArr.length > 0 ? formatMs(pgMed) : '—'} />
          <StatCard label="Median ts ms" value={tsArr.length > 0 ? formatMs(tsMed) : '—'} />
        </div>

        <Card className="h-80">
          {data.length === 0 ? (
            <EmptyState title="No data" hint="Start the probe to see latency" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" />
                <XAxis dataKey="time" tickFormatter={(v) => new Date(v).toLocaleTimeString()} style={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={v => formatMs(v)} style={{ fontSize: 11 }} width={60} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => formatInt(v) + ' r/s'} style={{ fontSize: 11 }} width={60} />
                <Tooltip 
                  labelFormatter={(v: any) => new Date(v).toLocaleTimeString()} 
                  formatter={(val: any, name: any) => [name === 'Ingest' ? formatInt(val) + ' r/s' : formatMs(val), name]}
                />
                <Legend verticalAlign="top" height={36} />
                <Line yAxisId="left" type="monotone" dataKey="pg" name="PostgreSQL" stroke={SERIES_COLORS.pg} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="left" type="monotone" dataKey="ts" name="TimescaleDB" stroke={SERIES_COLORS.ts} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="right" type="stepAfter" dataKey="ingestRate" name="Ingest" stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}
