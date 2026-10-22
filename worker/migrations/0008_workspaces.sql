CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'operator', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT OR IGNORE INTO workspaces (id, name, slug, created_by, created_at, updated_at)
VALUES ('ws_default', '默认工作区', 'default',
  (SELECT id FROM users ORDER BY CASE WHEN role = 'super_admin' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role, created_at)
SELECT 'ws_default', id,
  CASE WHEN id = (
    SELECT id FROM users ORDER BY CASE WHEN role = 'super_admin' THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1
  ) THEN 'owner' ELSE 'viewer' END,
  created_at
FROM users;

ALTER TABLE servers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE plugin_instances ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE domains ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE request_logs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE registration_codes ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE invites ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';
ALTER TABLE audit_log ADD COLUMN workspace_id TEXT;

UPDATE audit_log
SET workspace_id = 'ws_default'
WHERE workspace_id IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_servers_workspace ON servers(workspace_id);
CREATE INDEX IF NOT EXISTS idx_plugins_workspace ON plugin_instances(workspace_id);
CREATE INDEX IF NOT EXISTS idx_domains_workspace ON domains(workspace_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_workspace_created ON request_logs(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created ON audit_log(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_registration_codes_workspace ON registration_codes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invites_workspace ON invites(workspace_id);
