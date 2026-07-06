import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign } from '../../src/db/campaigns-repo';
import { createCharacter, getCharacterByPlayer, type StoredCharacter } from '../../src/db/characters-repo';
import { saveCombatState, getCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../../src/llm/combat-tools';
import type { ToolContext } from '../../src/llm/tools';

describe('combat tools', () => {
  let pool: Pool;
  let campaignId: string;
  let aria: StoredCharacter;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
    aria = await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
    const goblinSheet = createCharacterSheet(campaign.rulesetConfig, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: aria.id, name: 'Aria', isNpc: false, characterId: aria.id, sheet: aria.sheet },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: goblinSheet },
      ],
      order: [
        { id: aria.id, name: 'Aria', initiative: 15 },
        { id: 'npc-1', name: 'Goblin', initiative: 10 },
      ],
      currentIndex: 0,
    });
  });

  function makeCtx(): ToolContext {
    return { config: defaultRulesetConfig(), actingCharacter: aria, rng: () => 0.5, combat: { pool, campaignId } };
  }

  it('resolver_ataque encontra o alvo pelo nome e resolve o teste de ataque', async () => {
    const result = (await resolverAtaqueTool.execute({ targetName: 'Goblin' }, makeCtx())) as {
      targetId: string;
      hit: boolean;
      damage: number;
    };
    expect(result.targetId).toBe('npc-1');
    expect(result.hit).toBe(true);
    expect(result.damage).toBeGreaterThan(0);
  });

  it('resolver_ataque lança erro quando o alvo não existe', async () => {
    await expect(resolverAtaqueTool.execute({ targetName: 'Ninguém' }, makeCtx())).rejects.toThrow(/não encontrado/);
  });

  it('aplicar_dano subtrai o dano do alvo e persiste no personagem quando é jogador', async () => {
    const originalHp = aria.sheet.resources.hp as number;
    await aplicarDanoTool.execute({ targetId: aria.id, amount: 5 }, makeCtx());
    const updatedCharacter = await getCharacterByPlayer(pool, campaignId, 'player-1');
    expect(updatedCharacter?.sheet.resources.hp).toBe(originalHp - 5);
    const state = await getCombatState(pool, campaignId);
    const combatant = state?.combatants.find((c) => c.id === aria.id);
    expect(combatant?.sheet.resources.hp).toBe(originalHp - 5);
  });

  it('aplicar_dano não persiste em characters quando o alvo é NPC', async () => {
    await aplicarDanoTool.execute({ targetId: 'npc-1', amount: 5 }, makeCtx());
    const state = await getCombatState(pool, campaignId);
    const combatant = state?.combatants.find((c) => c.id === 'npc-1');
    expect(combatant?.sheet.resources.hp).toBe(6);
  });

  it('avancar_turno avança para o próximo combatente e persiste', async () => {
    const result = (await avancarTurnoTool.execute({}, makeCtx())) as { id: string; name: string };
    expect(result.name).toBe('Goblin');
    const state = await getCombatState(pool, campaignId);
    expect(state?.currentIndex).toBe(1);
  });
});
