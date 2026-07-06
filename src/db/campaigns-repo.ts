import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ValidatedRulesetConfig } from '../rules-engine';

export type CampaignStatus = 'draft' | 'active';

export interface Campaign {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  status: CampaignStatus;
  rulesetConfig: ValidatedRulesetConfig;
  lore: string;
  sessionSummary: string;
  sourceDocument: string;
  clarificationNotes: string;
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
    name: row.name as string,
    status: row.status as CampaignStatus,
    rulesetConfig: row.ruleset_config as ValidatedRulesetConfig,
    lore: row.lore as string,
    sessionSummary: row.session_summary as string,
    sourceDocument: row.source_document as string,
    clarificationNotes: row.clarification_notes as string,
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
  }
): Promise<Campaign> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore, source_document)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

export async function updateSessionSummary(pool: Pool, campaignId: string, sessionSummary: string): Promise<void> {
  await pool.query(`UPDATE campaigns SET session_summary = $2 WHERE id = $1`, [campaignId, sessionSummary]);
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

export async function activateCampaign(
  pool: Pool,
  campaignId: string,
  params: { lore: string; rulesetConfig: ValidatedRulesetConfig }
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET lore = $2, ruleset_config = $3, status = 'active' WHERE id = $1 RETURNING *`,
    [campaignId, params.lore, JSON.stringify(params.rulesetConfig)]
  );
  return rowToCampaign(result.rows[0]);
}
