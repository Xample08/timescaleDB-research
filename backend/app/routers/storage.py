from fastapi import APIRouter, Depends, Response
from app.deps import get_read_pool
from app.db import ConnectionPool
from app.schemas import StorageSizesResponse, StorageSizeDetails, StorageChunksResponse, ChunkItem

router = APIRouter(prefix="/storage", tags=["storage"])

@router.get("/sizes", response_model=StorageSizesResponse)
def get_storage_sizes(response: Response, pool: ConnectionPool = Depends(get_read_pool)):
    response.headers["Cache-Control"] = "public, max-age=30"
    
    query_pg = """
    SELECT
        pg_total_relation_size('telemetry_pg') as total_bytes,
        pg_relation_size('telemetry_pg') as table_bytes,
        pg_indexes_size('telemetry_pg') as index_bytes,
        approximate_row_count('telemetry_pg') as approx_rows
    """
    
    query_ts = """
    SELECT
        hypertable_size('telemetry_ts') as total_bytes,
        approximate_row_count('telemetry_ts') as approx_rows,
        (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_ts') as chunks_total,
        (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_ts' AND is_compressed) as chunks_compressed
    """
    
    query_ts_detailed = """
    SELECT table_bytes, index_bytes, toast_bytes 
    FROM hypertable_detailed_size('telemetry_ts')
    """
    
    query_ts_compression = """
    SELECT before_compression_total_bytes, after_compression_total_bytes 
    FROM hypertable_compression_stats('telemetry_ts')
    """

    with pool.acquire() as conn:
        pg_row = conn.run(query_pg)[0]
        ts_row = conn.run(query_ts)[0]
        ts_detailed_row = conn.run(query_ts_detailed)[0]
        
        # compression stats might be empty if not compressed
        ts_compression_rows = conn.run(query_ts_compression)
        before_bytes = None
        after_bytes = None
        if ts_compression_rows and ts_compression_rows[0][0] is not None:
            before_bytes = ts_compression_rows[0][0]
            after_bytes = ts_compression_rows[0][1]

    pg_details = StorageSizeDetails(
        total_bytes=pg_row[0],
        table_bytes=pg_row[1],
        index_bytes=pg_row[2],
        approx_rows=pg_row[3]
    )

    ts_details = StorageSizeDetails(
        total_bytes=ts_row[0],
        table_bytes=ts_detailed_row[0],
        index_bytes=ts_detailed_row[1],
        toast_bytes=ts_detailed_row[2],
        approx_rows=ts_row[1],
        chunks_total=ts_row[2] or 0,
        chunks_compressed=ts_row[3] or 0,
        before_compression_bytes=before_bytes,
        after_compression_bytes=after_bytes
    )

    return StorageSizesResponse(pg=pg_details, ts=ts_details)

@router.get("/chunks", response_model=StorageChunksResponse)
def get_storage_chunks(limit: int = 200, pool: ConnectionPool = Depends(get_read_pool)):
    query = """
    SELECT c.chunk_name, c.range_start, c.range_end, c.is_compressed, d.total_bytes
    FROM timescaledb_information.chunks c
    LEFT JOIN chunks_detailed_size('telemetry_ts') d ON d.chunk_name = c.chunk_name
    WHERE c.hypertable_name = 'telemetry_ts'
    ORDER BY c.range_start DESC
    LIMIT :limit
    """
    with pool.acquire() as conn:
        rows = conn.run(query, limit=limit)
        
    chunks = [
        ChunkItem(
            chunk_name=row[0],
            range_start=row[1],
            range_end=row[2],
            is_compressed=row[3],
            total_bytes=row[4]
        )
        for row in rows
    ]
    return StorageChunksResponse(chunks=chunks)
