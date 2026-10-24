CREATE TABLE IF NOT EXISTS admin_credentials (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DELETE FROM sessions;
DELETE FROM oauth_states;
DELETE FROM invites;
DELETE FROM registration_codes;
