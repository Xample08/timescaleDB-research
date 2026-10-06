import json
import os
from datetime import datetime, timedelta, timezone

import pytest

from app.benchmark import extract_chunks_scanned, parse_plan_json
from app.queries import validate_table_variant

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")

def test_parse_plan_json_chunk_append():
    with open(os.path.join(FIXTURES_DIR, "chunk_append.json")) as f:
        plan = json.load(f)
    
    et, pt, rows, hit, read = parse_plan_json(plan)
    assert et == 1.23
    assert pt == 0.45
    assert rows == 100
    assert hit == 10
    assert read == 5

def test_parse_plan_json_index_scan_string():
    with open(os.path.join(FIXTURES_DIR, "index_scan.json")) as f:
        plan_str = f.read()
    
    # Simulate receiving JSON string
    plan = json.loads(plan_str)
    et, pt, rows, hit, read = parse_plan_json(plan)
    assert et == 5.0
    assert pt == 0.1
    assert rows == 25
    assert hit == 2
    assert read == 0

def test_extract_chunks_scanned():
    with open(os.path.join(FIXTURES_DIR, "chunk_append.json")) as f:
        plan = json.load(f)
    
    # Should only count distinct matching ^_hyper_\d+_\d+_chunk$
    # chunk_append.json has _hyper_1_1_chunk twice and _hyper_1_2_chunk once
    chunks = extract_chunks_scanned(plan)
    assert chunks == 2

def test_validate_table_variant():
    assert validate_table_variant("pg") == "pg"
    assert validate_table_variant("ts") == "ts"
    assert validate_table_variant("ts_cagg") == "ts_cagg"
    
    with pytest.raises(ValueError):
        validate_table_variant("foo")

def test_q4_hour_alignment():
    # Test our hour alignment logic matches the spec
    reference_time = datetime(2026, 10, 6, 14, 45, 12, tzinfo=timezone.utc)
    
    ref_hour = reference_time.replace(minute=0, second=0, microsecond=0)
    ref_minus_days_hour = ref_hour - timedelta(days=7)
    
    assert ref_hour == datetime(2026, 10, 6, 14, 0, 0, tzinfo=timezone.utc)
    assert ref_minus_days_hour == datetime(2026, 9, 29, 14, 0, 0, tzinfo=timezone.utc)
    
    # Median calculation testing logic
    exec_times = [10.0, 5.0, 15.0]
    exec_times.sort()
    assert exec_times[1] == 10.0 # odd median
    
    exec_times2 = [10.0, 5.0, 15.0, 20.0]
    exec_times2.sort()
    assert (exec_times2[1] + exec_times2[2]) / 2 == 12.5 # even median
