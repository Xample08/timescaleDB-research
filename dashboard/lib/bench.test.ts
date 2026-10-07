import { describe, it, expect } from 'vitest';
import { 
  parsePlanJson, 
  parsePlanTextChunks, 
  checkRowCountMismatch, 
  computeB7Window, 
  percentile,
  CATALOG
} from './bench';

describe('bench.ts', () => {
  it('parses plan json for hypertable', () => {
    const fixture = [
      {
        "Plan": {
          "Actual Rows": 1000,
          "Shared Hit Blocks": 50,
          "Shared Read Blocks": 10
        },
        "Execution Time": 12.5,
        "Planning Time": 1.2
      },
      // extra string to simulate chunks in JSON string representation
      "_hyper_1_12_chunk",
      "_hyper_1_13_chunk"
    ];
    // parsePlanJson stringifies the plan to find chunks
    const res = parsePlanJson(fixture);
    expect(res.executionMs).toBe(12.5);
    expect(res.planningMs).toBe(1.2);
    expect(res.rowsReturned).toBe(1000);
    expect(res.sharedHit).toBe(50);
    expect(res.sharedRead).toBe(10);
    expect(res.chunksScanned).toBe(2);
  });

  it('parses plan json for pg', () => {
    const fixture = [
      {
        "Plan": {
          "Actual Rows": 500,
          "Shared Hit Blocks": 20,
          "Shared Read Blocks": 0
        },
        "Execution Time": 5.0,
        "Planning Time": 0.5
      }
    ];
    const res = parsePlanJson(fixture);
    expect(res.chunksScanned).toBeNull();
  });

  it('parses plan text for chunks', () => {
    const text = "Index Scan using _hyper_1_12_chunk_time_idx on _hyper_1_12_chunk ... ChunkAppend ... Index Scan on _hyper_1_13_chunk";
    expect(parsePlanTextChunks(text)).toBe(2);
    expect(parsePlanTextChunks("Index Scan on telemetry_pg")).toBeNull();
  });

  it('checks row count mismatch', () => {
    expect(checkRowCountMismatch([{ variant: 'pg', rowsReturned: 10 }, { variant: 'ts', rowsReturned: 10 }])).toBe(false);
    expect(checkRowCountMismatch([{ variant: 'pg', rowsReturned: 10 }, { variant: 'ts', rowsReturned: 9 }])).toBe(true);
  });

  it('computes B7 window clamp', () => {
    const ref = new Date('2026-10-07T12:30:00Z');
    const aggMin = new Date('2026-09-20T00:00:00Z');
    const aggMax = new Date('2026-10-07T11:00:00Z');
    const res = computeB7Window(ref, aggMin, aggMax);
    expect(res.end).toEqual(new Date('2026-10-07T11:00:00Z')); // clamped to aggMax
    expect(res.start).toEqual(new Date(res.end.getTime() - 7 * 86400_000));
    expect(res.error).toBeNull();
    expect(res.note).toContain('window end clamped');
  });

  it('handles B7 window errors (not covered)', () => {
    const ref = new Date('2026-10-07T12:30:00Z');
    const aggMin = new Date('2026-10-06T00:00:00Z');
    const aggMax = new Date('2026-10-07T11:00:00Z'); // difference is < 7 days and min > start
    const res = computeB7Window(ref, aggMin, aggMax);
    expect(res.error).toContain('continuous aggregate does not cover');
  });

  it('calculates percentile', () => {
    const arr = [15, 20, 35, 40, 50];
    expect(percentile(arr, 95)).toBe(50);
  });

  it('rejects invalid inline types in buildSql', () => {
    const B2 = CATALOG.find(q => q.id === 'B2')!;
    expect(() => B2.buildSql('pg', 1.5, new Date(), true)).toThrow('Value must be integer');
    expect(() => B2.buildSql('pg', 1, new Date('invalid'), true)).toThrow('Invalid date');
  });
});
