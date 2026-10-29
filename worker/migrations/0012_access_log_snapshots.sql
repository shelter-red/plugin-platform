CREATE TABLE request_logs_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  domain_id TEXT NOT NULL DEFAULT '',
  plugin_instance_id TEXT NOT NULL DEFAULT '',
  hostname TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'ws_default',
  server_id TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  plugin_name TEXT NOT NULL DEFAULT '',
  response_preview TEXT
);

INSERT INTO request_logs_v2 (
  id, user_id, domain_id, plugin_instance_id, hostname, method, path, status,
  duration_ms, error, created_at, workspace_id, server_id, server_name, plugin_name
)
SELECT
  request_logs.id,
  request_logs.user_id,
  request_logs.domain_id,
  request_logs.plugin_instance_id,
  request_logs.hostname,
  request_logs.method,
  request_logs.path,
  request_logs.status,
  request_logs.duration_ms,
  request_logs.error,
  request_logs.created_at,
  request_logs.workspace_id,
  COALESCE(plugin_instances.server_id, ''),
  COALESCE(servers.name, ''),
  COALESCE(plugin_instances.name, '')
FROM request_logs
LEFT JOIN plugin_instances ON plugin_instances.id = request_logs.plugin_instance_id
LEFT JOIN servers ON servers.id = plugin_instances.server_id;

DROP TABLE request_logs;
ALTER TABLE request_logs_v2 RENAME TO request_logs;

CREATE INDEX idx_request_logs_user_created ON request_logs(user_id, created_at);
CREATE INDEX idx_request_logs_created ON request_logs(created_at);
CREATE INDEX idx_request_logs_workspace_created ON request_logs(workspace_id, created_at);
CREATE INDEX idx_request_logs_server_created ON request_logs(workspace_id, server_id, created_at);
