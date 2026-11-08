export type StorageSize = {
  totalBytes: number;
  // All non-index storage, including TOAST and auxiliary relation files.
  tableBytes: number;
  indexBytes: number;
};

type Bytes = string | number | null | undefined;

export type ChunkStorage = {
  is_compressed: boolean;
  total_bytes: Bytes;
  index_bytes: Bytes;
  before_compression_total_bytes: Bytes;
  before_compression_index_bytes: Bytes;
};

export function storageSize(total: Bytes, index: Bytes): StorageSize | null {
  if (total == null || index == null || total === "" || index === "") return null;
  const totalBytes = Number(total);
  const indexBytes = Number(index);
  if (
    !Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(indexBytes) ||
    indexBytes < 0 || totalBytes < indexBytes
  ) return null;
  return { totalBytes, tableBytes: totalBytes - indexBytes, indexBytes };
}

export function reconstructBeforeStorage(
  current: StorageSize,
  parent: StorageSize,
  chunks: ChunkStorage[],
): StorageSize | null {
  // With no compressed chunks the actual current measurement is the baseline.
  if (!chunks.some(chunk => chunk.is_compressed)) return current;

  let total = parent.totalBytes;
  let index = parent.indexBytes;
  for (const chunk of chunks) {
    const size = chunk.is_compressed
      ? storageSize(chunk.before_compression_total_bytes, chunk.before_compression_index_bytes)
      : storageSize(chunk.total_bytes, chunk.index_bytes);
    // A partial baseline must not be displayed as the size of the whole hypertable.
    if (!size) return null;
    total += size.totalBytes;
    index += size.indexBytes;
  }
  return storageSize(total, index);
}

export function storageChartData(
  pg: Pick<StorageSize, "totalBytes" | "indexBytes">,
  ts: Pick<StorageSize, "totalBytes" | "indexBytes"> & {
    beforeCompressionBytes: number | null;
    beforeIndexBytes: number | null;
  },
) {
  const series = (name: string, total: number, index: number) => ({
    name, table: total - index, index,
  });
  const rows = [series("PostgreSQL", pg.totalBytes, pg.indexBytes)];
  if (ts.beforeCompressionBytes != null && ts.beforeIndexBytes != null) {
    rows.push(series("TimescaleDB (Before)", ts.beforeCompressionBytes, ts.beforeIndexBytes));
  }
  rows.push(series("TimescaleDB (After)", ts.totalBytes, ts.indexBytes));
  return rows;
}
