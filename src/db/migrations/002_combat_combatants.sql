ALTER TABLE combat_states ADD COLUMN combatants_json JSONB NOT NULL DEFAULT '[]';
