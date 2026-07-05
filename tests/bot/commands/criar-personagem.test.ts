import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, type Campaign } from '../../../src/db/campaigns-repo';
import { getCharacterByPlayer } from '../../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { buildCharacterModal, execute, handleModalSubmit } from '../../../src/bot/commands/criar-personagem';

describe('buildCharacterModal', () => {
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

  it('gera um customId codificando campanha e nome do personagem', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    expect(modal.toJSON().custom_id).toBe('criar-personagem:camp-1:Aria');
  });

  it('gera um campo de texto para cada atributo do ruleset', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    const json = modal.toJSON();
    const fieldIds = json.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));
    expect(fieldIds).toEqual(['forca', 'destreza', 'intelecto']);
  });
});

describe('/criar-personagem execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
  });

  it('mostra o modal quando a campanha existe e o jogador não tem personagem', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      options: { getString: () => 'Aria' },
      showModal,
      reply: vi.fn(),
    } as any;
    await execute(interaction, pool);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('recusa quando não há campanha ativa no canal', async () => {
    const reply = vi.fn();
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-sem-campanha',
      user: { id: 'player-1' },
      options: { getString: () => 'Aria' },
      showModal: vi.fn(),
      reply,
    } as any;
    await execute(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/nenhuma campanha/i) }));
  });
});

describe('/criar-personagem handleModalSubmit', () => {
  let pool: Pool;
  let campaign: Awaited<ReturnType<typeof createCampaign>>;

  beforeEach(async () => {
    pool = createTestPool();
    campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
  });

  it('cria o personagem a partir dos valores enviados no modal', async () => {
    const values: Record<string, string> = { forca: '3', destreza: '2', intelecto: '1' };
    const interaction = {
      customId: `criar-personagem:${campaign.id}:Aria`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply: vi.fn(),
    } as any;
    await handleModalSubmit(interaction, pool);
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character?.sheet.name).toBe('Aria');
    expect(character?.sheet.attributes).toEqual({ forca: 3, destreza: 2, intelecto: 1 });
  });

  it('recusa quando um atributo enviado não é numérico', async () => {
    const values: Record<string, string> = { forca: 'muito', destreza: '2', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `criar-personagem:${campaign.id}:Aria`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/forca/i) }));
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character).toBeNull();
  });
});
