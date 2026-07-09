import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CurrencyNames, ValidatedRulesetConfig } from '../rules-engine';
import { coerceRulesetConfig, FALLBACK_CURRENCY_NAMES } from '../rules-engine';

export type CampaignStatus = 'draft' | 'active' | 'paused';

export interface RecentExchange {
  characterName: string;
  playerMessage: string;
  narration: string;
}

export interface MasterGrantLogEntry {
  at: string;
  characterId: string;
  type: 'xp' | 'power' | 'wallet';
  amount?: number;
  powerKey?: string;
  majorDelta?: number;
  minorDelta?: number;
  reason: string;
  campaignMessageCount: number;
}

export interface Campaign {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  status: CampaignStatus;
  rulesetConfig: ValidatedRulesetConfig;
  lore: string;
  recentExchanges: RecentExchange[];
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  messagesSinceReflection: number;
  sourceDocument: string;
  clarificationNotes: string;
  createdByDiscordId: string | null;
  economyEnabled: boolean;
  currencyNames: CurrencyNames;
  campaignMessageCount: number;
  masterGrantLog: MasterGrantLogEntry[];
}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
    name: row.name as string,
    status: row.status as CampaignStatus,
    rulesetConfig: coerceRulesetConfig(parseJsonb(row.ruleset_config, {})),
    lore: row.lore as string,
    recentExchanges: parseJsonb<RecentExchange[]>(row.recent_exchanges, []),
    ritmoAtual: row.ritmo_atual as string,
    proximoMarco: row.proximo_marco as string,
    fatosCruciais: parseJsonb<string[]>(row.fatos_cruciais, []),
    messagesSinceReflection: Number(row.messages_since_reflection ?? 0),
    sourceDocument: row.source_document as string,
    clarificationNotes: row.clarification_notes as string,
    createdByDiscordId: (row.created_by_discord_id as string | null) ?? null,
    economyEnabled: Boolean(row.economy_enabled),
    currencyNames: parseJsonb<CurrencyNames>(row.currency_names, FALLBACK_CURRENCY_NAMES),
    campaignMessageCount: Number(row.campaign_message_count ?? 0),
    masterGrantLog: parseJsonb<MasterGrantLogEntry[]>(row.master_grant_log, []),
  };
}

export async function createCampaign(
  pool: Pool,
  params: {
    guildId: string;
    channelId: string;
    name: string;
    rulesetConfig: ValidatedRulesetConfig;
    lore?: string;
    status?: CampaignStatus;
    sourceDocument?: string;
    createdByDiscordId?: string | null;
    economyEnabled?: boolean;
    currencyNames?: CurrencyNames;
  }
): Promise<Campaign> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO campaigns (
       id, guild_id, channel_id, name, status, ruleset_config, lore, source_document,
       created_by_discord_id, economy_enabled, currency_names
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      id,
      params.guildId,
      params.channelId,
      params.name,
      params.status ?? 'active',
      JSON.stringify(params.rulesetConfig),
      params.lore ?? '',
      params.sourceDocument ?? '',
      params.createdByDiscordId ?? null,
      params.economyEnabled ?? false,
      JSON.stringify(params.currencyNames ?? FALLBACK_CURRENCY_NAMES),
    ]
  );
  return rowToCampaign(result.rows[0]);
}

export async function getCampaignByChannel(
  pool: Pool,
  guildId: string,
  channelId: string
): Promise<Campaign | null> {
  const result = await pool.query(`SELECT * FROM campaigns WHERE guild_id = $1 AND channel_id = $2`, [
    guildId,
    channelId,
  ]);
  return result.rows[0] ? rowToCampaign(result.rows[0]) : null;
}

export async function updateRecentExchanges(
  pool: Pool,
  campaignId: string,
  recentExchanges: RecentExchange[]
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET recent_exchanges = $2,
       messages_since_reflection = messages_since_reflection + 1,
       campaign_message_count = campaign_message_count + 1
     WHERE id = $1 RETURNING *`,
    [campaignId, JSON.stringify(recentExchanges)]
  );
  return rowToCampaign(result.rows[0]);
}

export async function updateNarrativeState(
  pool: Pool,
  campaignId: string,
  params: { ritmoAtual: string; proximoMarco: string; fatosCruciais: string[] }
): Promise<void> {
  await pool.query(
    `UPDATE campaigns SET ritmo_atual = $2, proximo_marco = $3, fatos_cruciais = $4, messages_since_reflection = 0
     WHERE id = $1`,
    [campaignId, params.ritmoAtual, params.proximoMarco, JSON.stringify(params.fatosCruciais)]
  );
}

export async function resetReflectionCounter(pool: Pool, campaignId: string): Promise<void> {
  await pool.query(`UPDATE campaigns SET messages_since_reflection = 0 WHERE id = $1`, [campaignId]);
}

export async function appendMasterGrantLog(
  pool: Pool,
  campaignId: string,
  entry: MasterGrantLogEntry
): Promise<void> {
  const campaign = await pool.query(`SELECT master_grant_log FROM campaigns WHERE id = $1`, [campaignId]);
  const log = parseJsonb<MasterGrantLogEntry[]>(campaign.rows[0]?.master_grant_log, []);
  const next = [...log, entry].slice(-50);
  await pool.query(`UPDATE campaigns SET master_grant_log = $2 WHERE id = $1`, [
    campaignId,
    JSON.stringify(next),
  ]);
}

export async function saveDraftProgress(
  pool: Pool,
  campaignId: string,
  params: { lore: string; rulesetConfig: unknown; clarificationNotes: string }
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET lore = $2, ruleset_config = $3, clarification_notes = $4 WHERE id = $1 RETURNING *`,
    [campaignId, params.lore, JSON.stringify(params.rulesetConfig), params.clarificationNotes]
  );
  return rowToCampaign(result.rows[0]);
}

export async function activateCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}

export async function pauseCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'paused' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}
