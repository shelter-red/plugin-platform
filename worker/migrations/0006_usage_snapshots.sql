CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  active_connections INTEGER NOT NULL,
  r2_bytes INTEGER NOT NULL,
  r2_objects INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_captured_at ON usage_snapshots(captured_at);
