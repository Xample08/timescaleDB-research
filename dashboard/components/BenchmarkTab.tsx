'use client';
import { useState, useEffect } from 'react';
import { Card, Field, Button, Badge, SERIES_COLORS, ErrorState, Spinner } from './ui';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { formatMs, formatInt } from '@/lib/format';
import { CATALOG, percentile } from '@/lib/bench';

type RunState = 'idle' | 'running' | 'done';

type AggregatedResult = {
  queryId: string;
  variant: string;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  rowsReturned: number;
  sharedHit: number;
  sharedRead: number;
  chunksScanned: number | null;
  valid: boolean;
};

type RunHistory = {
  id: string;
  createdAt: string;
  label?: string;
  set: string;
  repetitions: number;
  warmup: number;
  refTime: string;
  before: any;
  after: any;
  results: AggregatedResult[];
};

export function BenchmarkTab() {
  const [state, setState] = useState<RunState>('idle');
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  
  const [selectedSet, setSelectedSet] = useState<'quick'|'full'>('quick');
  const [selectedQueries, setSelectedQueries] = useState<Record<string, boolean>>(
    Object.fromEntries(CATALOG.map(q => [q.id, ['B1', 'B3', 'B6', 'B7'].includes(q.id)]))
  );
  
  const [repetitions, setRepetitions] = useState(5);
  const [warmup, setWarmup] = useState(1);
  const [vehicleId, setVehicleId] = useState('');
  
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [currentRun, setCurrentRun] = useState<RunHistory | null>(null);
  const [history, setHistory] = useState<RunHistory[]>([]);
  
  const [explainQuery, setExplainQuery] = useState<string | null>(null);
  const [explainData, setExplainData] = useState<any>(null);
  
  const [compareA, setCompareA] = useState<string>('');
  const [compareB, setCompareB] = useState<string>('');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tsdb-dashboard:runs:v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(parsed);
        if (parsed.length > 0) {
          setCurrentRun(parsed[0]);
          setCompareA(parsed[0].id);
          if (parsed.length > 1) setCompareB(parsed[1].id);
        }
      }
    } catch (e) {}
  }, []);

  const saveHistory = (run: RunHistory) => {
    try {
      const stored = localStorage.getItem('tsdb-dashboard:runs:v1');
      let parsed: RunHistory[] = stored ? JSON.parse(stored) : [];
      parsed = [run, ...parsed].slice(0, 30);
      localStorage.setItem('tsdb-dashboard:runs:v1', JSON.stringify(parsed));
      setHistory(parsed);
      setCurrentRun(run);
      if (!compareA) setCompareA(run.id);
      else if (!compareB && parsed.length > 1) setCompareB(parsed[1].id);
    } catch (e) {}
  };

  const handleSetChange = (val: 'quick'|'full') => {
    setSelectedSet(val);
    const quickIds = ['B1', 'B3', 'B6', 'B7'];
    const newSelected = Object.fromEntries(CATALOG.map(q => [q.id, val === 'full' || quickIds.includes(q.id)]));
    setSelectedQueries(newSelected);
  };

  const runBenchmark = async () => {
    setState('running');
    let isCancelled = false;
    setCancelFn(() => () => { isCancelled = true; });
    
    const queriesToRun = CATALOG.filter(q => selectedQueries[q.id]);
    const totalCalls = queriesToRun.length * (warmup + repetitions);
    setProgress({ done: 0, total: totalCalls });
    
    try {
      const stRes = await fetch('/api/status');
      if (!stRes.ok) throw new Error('Failed to fetch status');
      const stJson = await stRes.json();
      const refTime = stJson.safeReferenceTime;
      
      const resultsRaw: Record<string, any[]> = {};
      
      let done = 0;
      for (let rep = 0; rep < warmup + repetitions; rep++) {
        for (const q of queriesToRun) {
          if (isCancelled) break;
          
          const vOrder = rep % 2 === 0 ? q.variants : [...q.variants].reverse();
          
          const res = await fetch('/api/benchmark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queryId: q.id,
              variants: vOrder,
              refTime,
              vehicleId: vehicleId ? parseInt(vehicleId, 10) : null
            })
          });
          
          if (!res.ok) throw new Error(`Benchmark failed: ${res.statusText}`);
          const json = await res.json();
          
          if (rep >= warmup) {
            if (!resultsRaw[q.id]) resultsRaw[q.id] = [];
            resultsRaw[q.id].push(json.results);
          }
          
          done++;
          setProgress({ done, total: totalCalls });
        }
        if (isCancelled) break;
      }
      
      if (isCancelled) {
        setState('idle');
        return;
      }
      
      const stResAfter = await fetch('/api/status');
      const stJsonAfter = await stResAfter.ok ? await stResAfter.json() : null;
      
      // Aggregate
      const aggregated: AggregatedResult[] = [];
      for (const q of queriesToRun) {
        const reps = resultsRaw[q.id];
        if (!reps || reps.length === 0) continue;
        
        let valid = true;
        const lastRep = reps[reps.length - 1];
        if (lastRep.length > 1) {
          const firstRows = lastRep[0].rowsReturned;
          if (lastRep.some((r: any) => r.rowsReturned !== firstRows)) valid = false;
        }
        
        for (const v of q.variants) {
          const vMs = reps.map(r => r.find((x: any) => x.variant === v)?.executionMs || 0);
          const vLast = lastRep.find((x: any) => x.variant === v) || {};
          
          aggregated.push({
            queryId: q.id,
            variant: v,
            medianMs: percentile(vMs, 50),
            p95Ms: percentile(vMs, 95),
            minMs: Math.min(...vMs),
            maxMs: Math.max(...vMs),
            rowsReturned: vLast.rowsReturned || 0,
            sharedHit: vLast.sharedHit || 0,
            sharedRead: vLast.sharedRead || 0,
            chunksScanned: vLast.chunksScanned ?? null,
            valid
          });
        }
      }
      
      const runData: RunHistory = {
        id: new Date().getTime().toString(),
        createdAt: new Date().toISOString(),
        set: selectedSet,
        repetitions,
        warmup,
        refTime,
        before: stJson,
        after: stJsonAfter,
        results: aggregated
      };
      
      saveHistory(runData);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setState('done');
      setCancelFn(null);
    }
  };

  const loadExplain = async (qId: string) => {
    setExplainQuery(qId);
    setExplainData(null);
    if (!currentRun) return;
    try {
      const res = await fetch(`/api/explain?queryId=${qId}&refTime=${currentRun.refTime}&vehicleId=${vehicleId}`);
      if (res.ok) {
        setExplainData(await res.json());
      } else {
        setExplainData({ error: 'Failed to fetch explain' });
      }
    } catch (e: any) {
      setExplainData({ error: e.message });
    }
  };

  const exportCSV = () => {
    if (!currentRun) return;
    const header = "run_id,created_at,query_id,variant,median_ms,p95_ms,min_ms,max_ms,rows,shared_hit,shared_read,chunks_scanned,valid,ingest_pg_before,ingest_ts_before,chunks_total,chunks_compressed\n";
    const b = currentRun.before || {};
    const bChunks = b.chunks || {};
    const bIngest = b.ingest || {};
    
    const rows = currentRun.results.map(r => {
      return `${currentRun.id},${currentRun.createdAt},${r.queryId},${r.variant},${r.medianMs},${r.p95Ms},${r.minMs},${r.maxMs},${r.rowsReturned},${r.sharedHit},${r.sharedRead},${r.chunksScanned},${r.valid},${bIngest.pgRowsPerSecond || 0},${bIngest.tsRowsPerSecond || 0},${bChunks.total || 0},${bChunks.compressed || 0}`;
    });
    
    const blob = new Blob([header + rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark-${currentRun.id}.csv`;
    a.click();
  };

  const exportJSON = () => {
    if (!currentRun) return;
    const blob = new Blob([JSON.stringify(currentRun, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark-${currentRun.id}.json`;
    a.click();
  };

  const [logScale, setLogScale] = useState(true);

  // Chart data
  const chartData = [];
  if (currentRun) {
    const qIds = Array.from(new Set(currentRun.results.map(r => r.queryId)));
    for (const q of qIds) {
      const obj: any = { name: q };
      const qRes = currentRun.results.filter(r => r.queryId === q);
      for (const r of qRes) {
        obj[r.variant] = r.medianMs;
      }
      chartData.push(obj);
    }
  }
  
  // Compare data
  const runA = history.find(h => h.id === compareA);
  const runB = history.find(h => h.id === compareB);
  const compareTable = [];
  if (runA && runB) {
    const qvPairs = new Set<string>();
    runA.results.forEach(r => qvPairs.add(`${r.queryId}|${r.variant}`));
    runB.results.forEach(r => qvPairs.add(`${r.queryId}|${r.variant}`));
    
    for (const pair of Array.from(qvPairs).sort()) {
      const [q, v] = pair.split('|');
      const rA = runA.results.find(x => x.queryId === q && x.variant === v);
      const rB = runB.results.find(x => x.queryId === q && x.variant === v);
      const medA = rA ? rA.medianMs : null;
      const medB = rB ? rB.medianMs : null;
      const diffMs = medA != null && medB != null ? medB - medA : null;
      const diffPct = medA != null && medB != null && medA > 0 ? (diffMs! / medA) * 100 : null;
      
      compareTable.push({ q, v, medA, medB, diffMs, diffPct });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <Card title="Controls" className="xl:sticky xl:top-4 xl:self-start">
        <Field label="Set">
          <select disabled={state === 'running'} className="h-9 rounded-md border px-2 text-sm" value={selectedSet} onChange={e => handleSetChange(e.target.value as any)}>
            <option value="quick">Quick</option>
            <option value="full">Full</option>
          </select>
        </Field>
        
        <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mt-3 mb-1">Queries</div>
        <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-200 rounded p-2 dark:border-slate-800">
          {CATALOG.map(q => (
            <label key={q.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" disabled={state === 'running'} checked={!!selectedQueries[q.id]} onChange={e => setSelectedQueries({...selectedQueries, [q.id]: e.target.checked})} />
              <span>{q.id}: {q.title}</span>
            </label>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Repetitions">
            <input type="number" min="1" max="20" disabled={state === 'running'} className="h-9 rounded-md border px-2 text-sm" value={repetitions} onChange={e => setRepetitions(parseInt(e.target.value) || 1)} />
          </Field>
          <Field label="Warmup">
            <input type="number" min="0" max="3" disabled={state === 'running'} className="h-9 rounded-md border px-2 text-sm" value={warmup} onChange={e => setWarmup(parseInt(e.target.value) || 0)} />
          </Field>
        </div>
        
        <div className="mt-3">
          <Field label="Vehicle ID (optional)">
            <input type="number" disabled={state === 'running'} className="h-9 rounded-md border px-2 text-sm" value={vehicleId} onChange={e => setVehicleId(e.target.value)} />
          </Field>
        </div>

        <div className="mt-4">
          {state !== 'running' ? (
            <Button variant="primary" className="w-full" onClick={runBenchmark} disabled={Object.values(selectedQueries).every(v => !v) || repetitions < 1 || repetitions > 20 || warmup < 0 || warmup > 3}>
              Run Benchmark
            </Button>
          ) : (
            <Button variant="danger" className="w-full" onClick={() => cancelFn && cancelFn()}>
              Cancel ({progress.done} / {progress.total})
            </Button>
          )}
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {currentRun ? (
          <>
            <Card title="Results Chart" right={
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={logScale} onChange={e => setLogScale(e.target.checked)} />
                Log scale
              </label>
            } className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" />
                  <XAxis dataKey="name" style={{ fontSize: 11 }} />
                  <YAxis scale={logScale ? 'log' : 'auto'} domain={logScale ? ['auto', 'auto'] : [0, 'auto']} tickFormatter={v => formatMs(v)} style={{ fontSize: 11 }} width={60} allowDataOverflow={true} />
                  <Tooltip formatter={(val: any) => formatMs(val)} labelStyle={{ color: '#0f172a' }} />
                  <Legend verticalAlign="top" height={36} />
                  <Bar dataKey="pg" name="PostgreSQL" fill={SERIES_COLORS.pg} isAnimationActive={false} />
                  <Bar dataKey="ts" name="TimescaleDB" fill={SERIES_COLORS.ts} isAnimationActive={false} />
                  <Bar dataKey="ts_cagg" name="Timescale (CAGG)" fill={SERIES_COLORS.ts_cagg} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="min-w-0">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-sm font-semibold">Results Table</h2>
                <div className="space-x-2">
                  <Button onClick={exportCSV} variant="secondary">Export CSV</Button>
                  <Button onClick={exportJSON} variant="secondary">Export JSON</Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="py-2 font-medium">Query</th>
                      <th className="py-2 font-medium">Variant</th>
                      <th className="py-2 font-medium text-right">Median</th>
                      <th className="py-2 font-medium text-right">p95</th>
                      <th className="py-2 font-medium text-right">Min</th>
                      <th className="py-2 font-medium text-right">Max</th>
                      <th className="py-2 font-medium text-right">Rows</th>
                      <th className="py-2 font-medium text-right">Shared hit</th>
                      <th className="py-2 font-medium text-right">Shared read</th>
                      <th className="py-2 font-medium text-right">Chunks scanned</th>
                      <th className="py-2 font-medium text-right">ts ÷ pg</th>
                      <th className="py-2 font-medium text-center">Status</th>
                      <th className="py-2 font-medium text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRun.results.map((r, i) => {
                      const pgRes = currentRun.results.find(x => x.queryId === r.queryId && x.variant === 'pg');
                      const ratio = r.variant.startsWith('ts') && pgRes && pgRes.medianMs > 0 ? (r.medianMs / pgRes.medianMs).toFixed(2) : '—';
                      return (
                        <tr key={`${r.queryId}-${r.variant}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                          <td className="py-2 font-medium">{r.queryId}</td>
                          <td className="py-2"><Badge tone={r.variant === 'pg' ? 'neutral' : (r.variant === 'ts' ? 'warn' : 'ok')}>{r.variant}</Badge></td>
                          <td className="py-2 text-right tabular-nums">{formatMs(r.medianMs)}</td>
                          <td className="py-2 text-right tabular-nums">{formatMs(r.p95Ms)}</td>
                          <td className="py-2 text-right tabular-nums">{formatMs(r.minMs)}</td>
                          <td className="py-2 text-right tabular-nums">{formatMs(r.maxMs)}</td>
                          <td className="py-2 text-right tabular-nums">{formatInt(r.rowsReturned)}</td>
                          <td className="py-2 text-right tabular-nums">{formatInt(r.sharedHit)}</td>
                          <td className="py-2 text-right tabular-nums">{formatInt(r.sharedRead)}</td>
                          <td className="py-2 text-right tabular-nums">{r.chunksScanned ?? '—'}</td>
                          <td className="py-2 text-right tabular-nums">{ratio}</td>
                          <td className="py-2 text-center">
                            {r.valid ? <Badge tone="ok">Valid</Badge> : <Badge tone="error">Row count mismatch</Badge>}
                          </td>
                          <td className="py-2 text-center">
                            {i === currentRun.results.findIndex(x => x.queryId === r.queryId) && (
                              <button onClick={() => loadExplain(r.queryId)} className="text-blue-600 hover:underline">EXPLAIN</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <span className="text-sm text-slate-500">Run a benchmark to see results</span>
          </div>
        )}

        {explainQuery && (
          <Card title={`EXPLAIN for ${explainQuery}`}>
            <div className="flex justify-end mb-2"><Button onClick={() => setExplainQuery(null)}>Close</Button></div>
            {!explainData ? <Spinner /> : explainData.error ? <ErrorState message={explainData.error} /> : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="border border-slate-200 rounded-md p-3 bg-slate-50 dark:bg-slate-950 dark:border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm">PostgreSQL</span>
                  </div>
                  <pre className="text-[10px] overflow-auto whitespace-pre h-96">{explainData.variants.pg?.text}</pre>
                </div>
                <div className="border border-slate-200 rounded-md p-3 bg-slate-50 dark:bg-slate-950 dark:border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-sm">TimescaleDB</span>
                    <Badge tone="neutral">Chunks scanned: {explainData.variants.ts?.chunksScanned ?? 0} of {explainData.chunksTotal}</Badge>
                  </div>
                  <pre className="text-[10px] overflow-auto whitespace-pre h-96">{explainData.variants.ts?.text}</pre>
                </div>
              </div>
            )}
          </Card>
        )}

        {history.length > 1 && (
          <Card title="Compare Runs">
            <div className="flex gap-4 mb-4">
              <Field label="Run A">
                <select className="h-9 rounded-md border px-2 text-sm" value={compareA} onChange={e => setCompareA(e.target.value)}>
                  {history.map(h => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()} ({h.set})</option>)}
                </select>
              </Field>
              <Field label="Run B">
                <select className="h-9 rounded-md border px-2 text-sm" value={compareB} onChange={e => setCompareB(e.target.value)}>
                  {history.map(h => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()} ({h.set})</option>)}
                </select>
              </Field>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 font-medium">Query</th>
                    <th className="py-2 font-medium">Variant</th>
                    <th className="py-2 font-medium text-right">Median A</th>
                    <th className="py-2 font-medium text-right">Median B</th>
                    <th className="py-2 font-medium text-right">Diff (ms)</th>
                    <th className="py-2 font-medium text-right">Diff (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {compareTable.map(r => (
                    <tr key={`${r.q}-${r.v}`} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <td className="py-2 font-medium">{r.q}</td>
                      <td className="py-2">{r.v}</td>
                      <td className="py-2 text-right tabular-nums">{r.medA != null ? formatMs(r.medA) : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{r.medB != null ? formatMs(r.medB) : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{r.diffMs != null ? (r.diffMs > 0 ? '+' : '') + r.diffMs.toFixed(2) : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{r.diffPct != null ? (r.diffPct > 0 ? '+' : '') + r.diffPct.toFixed(1) + '%' : '—'}</td>
                    </tr>
                  ))}
                  {compareTable.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-slate-500">Select two different runs</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
