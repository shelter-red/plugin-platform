CREATE TABLE IF NOT EXISTS platform_usage (
  key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  request_window_started_at TEXT NOT NULL,
  active_connections INTEGER NOT NULL DEFAULT 0,
  r2_bytes INTEGER NOT NULL DEFAULT 0,
  r2_objects INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO platform_usage (key, request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at)
VALUES ('global', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0,
  COALESCE((SELECT SUM(size_bytes) FROM temp_objects WHERE consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), 0),
  COALESCE((SELECT COUNT(*) FROM temp_objects WHERE consumed_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
