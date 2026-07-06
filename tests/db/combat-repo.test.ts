import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { saveCombatState, getCombatState, clearCombatState, type StoredCombatState } from '../../src/db/combat-repo';

describe('combat-repo', () => {
  let pool: Pool;
  let campaignId: string;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
  });

  function makeState(): StoredCombatState {
    return {
      campaignId,
      combatants: [
        {
          id: 'char-1',
          name: 'Aria',
          isNpc: false,
          characterId: 'char-1',
          sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
        },
        {
          id: 'npc-1',
          name: 'Goblin',
          isNpc: true,
          sheet: { name: 'Goblin', attributes: { forca: 1, destreza: 1, intelecto: 1 }, resources: { hp: 11 }, inventory: [] },
        },
      ],
      order: [
        { id: 'npc-1', name: 'Goblin', initiative: 15 },
        { id: 'char-1', name: 'Aria', initiative: 10 },
      ],
      currentIndex: 0,
    };
  }

  it('salva e recupera o estado de combate de uma campanha', async () => {
    await saveCombatState(pool, makeState());
    const found = await getCombatState(pool, campaignId);
    expect(found).toEqual(makeState());
  });

  it('retorna null quando não há combate em andamento', async () => {
    const found = await getCombatState(pool, campaignId);
    expect(found).toBeNull();
  });

  it('sobrescreve o estado existente ao salvar novamente', async () => {
    await saveCombatState(pool, makeState());
    await saveCombatState(pool, { ...makeState(), currentIndex: 1 });
    const found = await getCombatState(pool, campaignId);
    expect(found?.currentIndex).toBe(1);
  });

  it('remove o estado de combate', async () => {
    await saveCombatState(pool, makeState());
    await clearCombatState(pool, campaignId);
    const found = await getCombatState(pool, campaignId);
    expect(found).toBeNull();
  });
});
