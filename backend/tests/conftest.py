"""Test configuration: provide a dummy DSN so ``app.main`` can be imported without a .env."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("TIGER_CONNECTION_STRING", "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
