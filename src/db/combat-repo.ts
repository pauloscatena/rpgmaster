import type { Pool } from 'pg';
import type { CharacterSheet, Combatant } from '../rules-engine';

export interface CombatCombatant {
  id: string;
  name: string;
  isNpc: boolean;
  characterId?: string;
  sheet: CharacterSheet;
}

export interface StoredCombatState {
  campaignId: string;
  combatants: CombatCombatant[];
  order: Combatant[];
  currentIndex: number;
}

function rowToState(row: Record<string, unknown>): StoredCombatState {
  return {
    campaignId: row.campaign_id as string,
    combatants: row.combatants_json as CombatCombatant[],
    order: row.order_json as Combatant[],
    currentIndex: row.current_index as number,
  };
}

export async function saveCombatState(pool: Pool, state: StoredCombatState): Promise<void> {
  await pool.query(
    `INSERT INTO combat_states (campaign_id, order_json, current_index, combatants_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id) DO UPDATE
       SET order_json = $2, current_index = $3, combatants_json = $4, updated_at = now()`,
    [state.campaignId, JSON.stringify(state.order), state.currentIndex, JSON.stringify(state.combatants)]
  );
}

export async function getCombatState(pool: Pool, campaignId: string): Promise<StoredCombatState | null> {
  const result = await pool.query(`SELECT * FROM combat_states WHERE campaign_id = $1`, [campaignId]);
  return result.rows[0] ? rowToState(result.rows[0]) : null;
}

export async function clearCombatState(pool: Pool, campaignId: string): Promise<void> {
  await pool.query(`DELETE FROM combat_states WHERE campaign_id = $1`, [campaignId]);
}
