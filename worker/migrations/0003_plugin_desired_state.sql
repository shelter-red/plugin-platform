ALTER TABLE plugin_instances ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'discovered';

UPDATE plugin_instances
SET desired_state = state
WHERE state IN ('loaded', 'enabled', 'disabled', 'unloaded');
