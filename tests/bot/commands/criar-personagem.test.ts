import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, type Campaign } from '../../../src/db/campaigns-repo';
import { getCharacterByPlayer } from '../../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import {
  buildCharacterModal,
  execute,
  handleModalSubmit,
  MAX_ATTRIBUTE_VALUE,
  MAX_ATTRIBUTE_POINTS_TOTAL,
} from '../../../src/bot/commands/criar-personagem';

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
    sourceDocument: '',
    clarificationNotes: '',
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

  it('inclui o valor máximo permitido no título de cada campo de atributo', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    const json = modal.toJSON();
    const labels = json.components.flatMap((row: any) => row.components.map((c: any) => c.label));
    for (const label of labels) {
      expect(label).toContain(String(MAX_ATTRIBUTE_VALUE));
    }
  });

  it('inclui o orçamento total de pontos no título do modal quando o nome é curto o suficiente', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    const json = modal.toJSON();
    expect(json.title).toContain(String(MAX_ATTRIBUTE_POINTS_TOTAL));
  });

  it('usa o título sem orçamento quando nome + orçamento passariam do limite de 45 caracteres do Discord', () => {
    const nomeLongo = 'Sir Reginald: The Bold';
    const modal = buildCharacterModal(campaign, nomeLongo);
    const json = modal.toJSON();
    expect(json.title).toBe(`Atributos de ${nomeLongo}`);
    expect(json.title.length).toBeLessThanOrEqual(45);
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

  it('recusa quando um atributo enviado tem lixo alfabético misturado com dígitos', async () => {
    const values: Record<string, string> = { forca: '3abc', destreza: '2', intelecto: '1' };
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

  it('recusa quando um atributo enviado é decimal em vez de inteiro', async () => {
    const values: Record<string, string> = { forca: '3.7', destreza: '2', intelecto: '1' };
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

  it('recusa quando um atributo enviado tem espaços em branco ao redor do número', async () => {
    const values: Record<string, string> = { forca: '  3', destreza: '2', intelecto: '1' };
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

  it('recusa quando um atributo enviado ultrapassa o valor máximo permitido', async () => {
    const values: Record<string, string> = { forca: String(MAX_ATTRIBUTE_VALUE + 1), destreza: '2', intelecto: '1' };
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
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(new RegExp(`forca.*${MAX_ATTRIBUTE_VALUE}`, 'i')) })
    );
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character).toBeNull();
  });

  it('aceita um atributo exatamente igual ao valor máximo permitido', async () => {
    const values: Record<string, string> = { forca: String(MAX_ATTRIBUTE_VALUE), destreza: '2', intelecto: '1' };
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
    expect(character?.sheet.attributes.forca).toBe(MAX_ATTRIBUTE_VALUE);
  });

  it('recusa quando a soma dos atributos ultrapassa o orçamento total de pontos', async () => {
    const values: Record<string, string> = { forca: '15', destreza: '10', intelecto: '10' };
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
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(new RegExp(`35.*${MAX_ATTRIBUTE_POINTS_TOTAL}`)) })
    );
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character).toBeNull();
  });

  it('aceita quando a soma dos atributos é exatamente igual ao orçamento total de pontos', async () => {
    const values: Record<string, string> = { forca: '10', destreza: '10', intelecto: '10' };
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
    expect(character?.sheet.attributes).toEqual({ forca: 10, destreza: 10, intelecto: 10 });
  });

  it('aceita um atributo negativo válido (modificador negativo)', async () => {
    const values: Record<string, string> = { forca: '-2', destreza: '2', intelecto: '1' };
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
    expect(character?.sheet.attributes).toEqual({ forca: -2, destreza: 2, intelecto: 1 });
  });

  it('preserva o nome completo do personagem quando ele contém dois-pontos', async () => {
    const values: Record<string, string> = { forca: '3', destreza: '2', intelecto: '1' };
    const nomeComDoisPontos = 'Sir Reginald: The Bold';
    const interaction = {
      customId: `criar-personagem:${campaign.id}:${nomeComDoisPontos}`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply: vi.fn(),
    } as any;
    await handleModalSubmit(interaction, pool);
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character?.sheet.name).toBe(nomeComDoisPontos);
    expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining(nomeComDoisPontos));
  });

  it('extrai corretamente o campaignId quando o nome do personagem contém dois-pontos', async () => {
    const values: Record<string, string> = { forca: '3', destreza: '2', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `criar-personagem:campanha-inexistente:Sir Reginald: The Bold`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/campanha não encontrada/i) }));
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character).toBeNull();
  });
});
