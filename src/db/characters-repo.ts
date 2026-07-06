import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CharacterSheet } from '../rules-engine';

export interface StoredCharacter {
  id: string;
  campaignId: string;
  playerDiscordId: string;
  sheet: CharacterSheet;
}

function rowToCharacter(row: Record<string, unknown>): StoredCharacter {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    playerDiscordId: row.player_discord_id as string,
    sheet: {
      name: row.name as string,
      attributes: row.attributes as Record<string, number>,
      resources: row.resources as Record<string, number>,
      inventory: row.inventory as string[],
    },
  };
}

export async function createCharacter(
  pool: Pool,
  params: { campaignId: string; playerDiscordId: string; sheet: CharacterSheet }
): Promise<StoredCharacter> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO characters (id, campaign_id, player_discord_id, name, attributes, resources, inventory)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      params.campaignId,
      params.playerDiscordId,
      params.sheet.name,
      JSON.stringify(params.sheet.attributes),
      JSON.stringify(params.sheet.resources),
      JSON.stringify(params.sheet.inventory),
    ]
  );
  return rowToCharacter(result.rows[0]);
}

export async function getCharacterByPlayer(
  pool: Pool,
  campaignId: string,
  playerDiscordId: string
): Promise<StoredCharacter | null> {
  const result = await pool.query(
    `SELECT * FROM characters WHERE campaign_id = $1 AND player_discord_id = $2`,
    [campaignId, playerDiscordId]
  );
  return result.rows[0] ? rowToCharacter(result.rows[0]) : null;
}

export async function getCharactersByCampaign(pool: Pool, campaignId: string): Promise<StoredCharacter[]> {
  const result = await pool.query(`SELECT * FROM characters WHERE campaign_id = $1`, [campaignId]);
  return result.rows.map(rowToCharacter);
}

export async function updateCharacterResources(
  pool: Pool,
  characterId: string,
  resources: Record<string, number>
): Promise<StoredCharacter> {
  const result = await pool.query(`UPDATE characters SET resources = $2 WHERE id = $1 RETURNING *`, [
    characterId,
    JSON.stringify(resources),
  ]);
  return rowToCharacter(result.rows[0]);
}
