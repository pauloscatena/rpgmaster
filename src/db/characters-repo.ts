import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CharacterPower, CharacterSheet, InventoryItem, Wallet } from '../rules-engine';
import { defaultShortName, normalizeInventory } from '../rules-engine';

export interface StoredCharacter {
  id: string;
  campaignId: string;
  playerDiscordId: string;
  sheet: CharacterSheet;
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

function rowToCharacter(row: Record<string, unknown>): StoredCharacter {
  const name = row.name as string;
  const shortNameRaw = (row.short_name as string | null | undefined) ?? '';
  const shortName = shortNameRaw.trim() || defaultShortName(name);
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    playerDiscordId: row.player_discord_id as string,
    sheet: {
      name,
      shortName,
      attributes: parseJsonb(row.attributes, {}),
      resources: parseJsonb(row.resources, {}),
      inventory: normalizeInventory(parseJsonb(row.inventory, [])),
      bagCapacity: Number(row.bag_capacity ?? 10),
      classKey: (row.class_key as string | null) ?? null,
      xp: Number(row.xp ?? 0),
      powers: parseJsonb<CharacterPower[]>(row.powers, []),
      wallet: {
        major: Number(row.wallet_major ?? 0),
        minor: Number(row.wallet_minor ?? 0),
      },
      lastMasterGrantAtCampaignMessages:
        row.last_master_grant_at_campaign_messages == null
          ? null
          : Number(row.last_master_grant_at_campaign_messages),
    },
  };
}

export async function createCharacter(
  pool: Pool,
  params: { campaignId: string; playerDiscordId: string; sheet: CharacterSheet }
): Promise<StoredCharacter> {
  const id = randomUUID();
  const sheet = params.sheet;
  const result = await pool.query(
    `INSERT INTO characters (
       id, campaign_id, player_discord_id, name, short_name, attributes, resources, inventory,
       bag_capacity, class_key, xp, powers, wallet_major, wallet_minor, last_master_grant_at_campaign_messages
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      id,
      params.campaignId,
      params.playerDiscordId,
      sheet.name,
      sheet.shortName || defaultShortName(sheet.name),
      JSON.stringify(sheet.attributes),
      JSON.stringify(sheet.resources),
      JSON.stringify(sheet.inventory),
      sheet.bagCapacity,
      sheet.classKey,
      sheet.xp,
      JSON.stringify(sheet.powers),
      sheet.wallet.major,
      sheet.wallet.minor,
      sheet.lastMasterGrantAtCampaignMessages,
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

export async function updateCharacterAttributes(
  pool: Pool,
  characterId: string,
  attributes: Record<string, number>
): Promise<StoredCharacter> {
  const result = await pool.query(`UPDATE characters SET attributes = $2 WHERE id = $1 RETURNING *`, [
    characterId,
    JSON.stringify(attributes),
  ]);
  return rowToCharacter(result.rows[0]);
}

export async function updateCharacterInventory(
  pool: Pool,
  characterId: string,
  inventory: InventoryItem[]
): Promise<StoredCharacter> {
  const result = await pool.query(`UPDATE characters SET inventory = $2 WHERE id = $1 RETURNING *`, [
    characterId,
    JSON.stringify(inventory),
  ]);
  return rowToCharacter(result.rows[0]);
}

export async function updateCharacterBagCapacity(
  pool: Pool,
  characterId: string,
  bagCapacity: number
): Promise<StoredCharacter> {
  const result = await pool.query(`UPDATE characters SET bag_capacity = $2 WHERE id = $1 RETURNING *`, [
    characterId,
    bagCapacity,
  ]);
  return rowToCharacter(result.rows[0]);
}

export async function updateCharacterProgress(
  pool: Pool,
  characterId: string,
  patch: {
    xp?: number;
    powers?: CharacterPower[];
    classKey?: string | null;
    attributes?: Record<string, number>;
    wallet?: Wallet;
    lastMasterGrantAtCampaignMessages?: number | null;
  }
): Promise<StoredCharacter> {
  const current = await pool.query(`SELECT * FROM characters WHERE id = $1`, [characterId]);
  if (!current.rows[0]) throw new Error(`Personagem ${characterId} não encontrado.`);
  const sheet = rowToCharacter(current.rows[0]).sheet;
  const next = {
    xp: patch.xp ?? sheet.xp,
    powers: patch.powers ?? sheet.powers,
    classKey: patch.classKey !== undefined ? patch.classKey : sheet.classKey,
    attributes: patch.attributes ?? sheet.attributes,
    wallet: patch.wallet ?? sheet.wallet,
    lastMasterGrantAtCampaignMessages:
      patch.lastMasterGrantAtCampaignMessages !== undefined
        ? patch.lastMasterGrantAtCampaignMessages
        : sheet.lastMasterGrantAtCampaignMessages,
  };
  const result = await pool.query(
    `UPDATE characters SET
       xp = $2, powers = $3, class_key = $4, attributes = $5,
       wallet_major = $6, wallet_minor = $7, last_master_grant_at_campaign_messages = $8
     WHERE id = $1 RETURNING *`,
    [
      characterId,
      next.xp,
      JSON.stringify(next.powers),
      next.classKey,
      JSON.stringify(next.attributes),
      next.wallet.major,
      next.wallet.minor,
      next.lastMasterGrantAtCampaignMessages,
    ]
  );
  return rowToCharacter(result.rows[0]);
}
