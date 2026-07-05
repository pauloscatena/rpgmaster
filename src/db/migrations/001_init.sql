CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ruleset_config JSONB NOT NULL,
  lore TEXT NOT NULL DEFAULT '',
  session_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, channel_id)
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_discord_id TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes JSONB NOT NULL,
  resources JSONB NOT NULL,
  inventory JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, player_discord_id)
);

CREATE TABLE combat_states (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  order_json JSONB NOT NULL,
  current_index INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
