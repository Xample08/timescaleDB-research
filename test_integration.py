import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from app.schemas import BenchmarkRunRequest
from app.benchmark import run_benchmark
from app.config import Settings, get_settings
from app.db import ConnectionPool

import logging
logging.basicConfig(level=logging.DEBUG)

req = BenchmarkRunRequest(query_ids=["q1", "q2", "q3", "q4"], repetitions=1, warmup=0)
try:
    resp = run_benchmark(req, "test-run")
    print("SUCCESS")
    for r in resp.results:
        print(r.query_id, r.variant, r.median_ms, r.rows_returned, r.error)
except Exception as e:
    print("ERROR:", e)
    import traceback
    traceback.print_exc()
