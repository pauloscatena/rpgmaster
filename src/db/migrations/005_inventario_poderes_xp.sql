-- Campanha: organizador, economia, moedas, contadores e log de concessões do Mestre
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS created_by_discord_id TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS economy_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS currency_names JSONB NOT NULL DEFAULT '{"major":"moedas de ouro","minor":"moedas de prata"}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_message_count INT NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS master_grant_log JSONB NOT NULL DEFAULT '[]';

-- Personagem: short_name, bolsa, classe, xp, poderes, carteira, cooldown de grant
-- short_name vazio é preenchido no repo via defaultShortName(name)
ALTER TABLE characters ADD COLUMN IF NOT EXISTS short_name TEXT NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS bag_capacity INT NOT NULL DEFAULT 10;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS class_key TEXT;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS xp INT NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS powers JSONB NOT NULL DEFAULT '[]';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS wallet_major INT NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS wallet_minor INT NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN IF NOT EXISTS last_master_grant_at_campaign_messages INT;
