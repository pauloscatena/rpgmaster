import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, type Campaign } from '../../../src/db/campaigns-repo';
import { createCharacter } from '../../../src/db/characters-repo';
import { getCombatState } from '../../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../../src/rules-engine';
import { buildEnemyModal, execute, handleModalSubmit } from '../../../src/bot/commands/iniciar-combate';

describe('buildEnemyModal', () => {
  const campaign: Campaign = {
    id: 'camp-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    name: 'Teste',
    status: 'active',
    rulesetConfig: defaultRulesetConfig(),
    lore: '',
    sessionSummary: '',
  };

  it('gera um customId codificando campanha e nome do inimigo', () => {
    const modal = buildEnemyModal(campaign, 'Goblin');
    expect(modal.toJSON().custom_id).toBe('iniciar-combate:camp-1:Goblin');
  });
});

describe('/iniciar-combate execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  it('mostra o modal do inimigo quando há ao menos um personagem na campanha', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      options: { getString: () => 'Goblin' },
      showModal,
      reply: vi.fn(),
    } as any;
    await execute(interaction, pool);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('recusa quando nenhum personagem foi criado na campanha', async () => {
    const otherPool = createTestPool();
    await createCampaign(otherPool, {
      guildId: 'guild-2',
      channelId: 'channel-2',
      name: 'Sem personagens',
      rulesetConfig: defaultRulesetConfig(),
    });
    const reply = vi.fn();
    const interaction = {
      guildId: 'guild-2',
      channelId: 'channel-2',
      options: { getString: () => 'Goblin' },
      showModal: vi.fn(),
      reply,
    } as any;
    await execute(interaction, otherPool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/ninguém tem personagem/i) }));
  });
});

describe('/iniciar-combate handleModalSubmit', () => {
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
    await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  it('calcula a iniciativa, salva o estado de combate e anuncia a ordem', async () => {
    const values: Record<string, string> = { forca: '1', destreza: '1', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `iniciar-combate:${campaignId}:Goblin`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    const state = await getCombatState(pool, campaignId);
    expect(state?.combatants.map((c) => c.name).sort()).toEqual(['Aria', 'Goblin']);
    expect(state?.order.length).toBe(2);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/combate iniciado/i));
  });

  it('recusa quando um atributo do inimigo não é numérico', async () => {
    const values: Record<string, string> = { forca: 'muito', destreza: '1', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `iniciar-combate:${campaignId}:Goblin`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/forca/i) }));
    const state = await getCombatState(pool, campaignId);
    expect(state).toBeNull();
  });

  it('preserva o nome completo do inimigo quando ele contém dois-pontos', async () => {
    const values: Record<string, string> = { forca: '1', destreza: '1', intelecto: '1' };
    const nomeComDoisPontos = 'Capitão: Vilão';
    const reply = vi.fn();
    const interaction = {
      customId: `iniciar-combate:${campaignId}:${nomeComDoisPontos}`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    const state = await getCombatState(pool, campaignId);
    expect(state?.combatants.map((c) => c.name)).toContain(nomeComDoisPontos);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining(nomeComDoisPontos));
  });
});
