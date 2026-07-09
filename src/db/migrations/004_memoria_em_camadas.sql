ALTER TABLE campaigns DROP COLUMN session_summary;
ALTER TABLE campaigns ADD COLUMN recent_exchanges JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN ritmo_atual TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN proximo_marco TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN fatos_cruciais JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN messages_since_reflection INT NOT NULL DEFAULT 0;
