import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { saveCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import type { LlmProvider } from '../../src/llm/provider';
import * as ingestion from '../../src/ingestion/extract';

describe('handleMessage', () => {
  let pool: Pool;
  let campaignId: string;
  let ariaId: string;
  const claudeClient = {} as Anthropic;

  function makeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
      runTurn: vi.fn().mockResolvedValue({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] }),
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    campaignId = campaign!.id;
    const aria = await createCharacter(pool, {
      campaignId: campaign!.id,
      playerDiscordId: 'player-1',
      sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
    });
    ariaId = aria.id;
  });

  function makeMessage(content: string, authorId = 'player-1', isBot = false) {
    const replies: string[] = [];
    return {
      author: { id: authorId, bot: isBot },
      guildId: 'guild-1',
      channelId: 'channel-1',
      content,
      channel: { sendTyping: vi.fn().mockResolvedValue(undefined) },
      reply: async (text: string) => {
        replies.push(text);
      },
      _replies: replies,
    } as any;
  }

  it('ignora mensagens de outros bots', async () => {
    const llmProvider = makeLlmProvider();
    await handleMessage(makeMessage('oi', 'bot-1', true), pool, llmProvider, claudeClient);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('ignora mensagens em canais sem campanha ativa', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('oi');
    message.channelId = 'channel-sem-campanha';
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  describe('campanha em rascunho', () => {
    async function makeDraftCampaign() {
      const draftCampaign = await createCampaign(pool, {
        guildId: 'guild-1',
        channelId: 'channel-draft',
        name: 'Campanha em rascunho',
        rulesetConfig: defaultRulesetConfig(),
        sourceDocument: 'documento original da campanha',
        status: 'draft',
      });
      await createCharacter(pool, {
        campaignId: draftCampaign.id,
        playerDiscordId: 'player-1',
        sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
      });
      return draftCampaign;
    }

    it('trata a mensagem como resposta de revisão em vez de chamar o LLM narrativo', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
        lore: 'Uma torre antiga.',
        rulesetConfig: defaultRulesetConfig(),
        clarifyingQuestions: ['Qual é o dado de dano? Sugiro d6.'],
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de teste é d20');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(llmProvider.runTurn).not.toHaveBeenCalled();
      expect(message._replies[0]).toMatch(/qual é o dado de dano/i);
    });

    it('nunca ativa a campanha sozinha, mesmo quando a extração fica completa', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
        lore: 'Uma torre antiga.',
        rulesetConfig: defaultRulesetConfig(),
        clarifyingQuestions: [],
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de dano é d6');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-draft');
      expect(campaign?.status).toBe('draft');
      expect(message._replies[0]).toMatch(/\/iniciar-campanha/);
    });

    it('responde com mensagem amigável quando o processamento falha', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockRejectedValue(new Error('boom'));
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de teste é d20');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(message._replies[0]).toMatch(/não consegui processar/i);
    });
  });

  describe('campanha pausada', () => {
    it('ignora mensagens no canal, sem chamar o LLM nem responder', async () => {
      await createCampaign(pool, {
        guildId: 'guild-1',
        channelId: 'channel-paused',
        name: 'Campanha pausada',
        rulesetConfig: defaultRulesetConfig(),
        status: 'paused',
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('alguém aí?');
      message.channelId = 'channel-paused';

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(llmProvider.runTurn).not.toHaveBeenCalled();
      expect(message._replies).toHaveLength(0);
    });
  });

  it('pede para criar personagem quando o autor não tem ficha na campanha', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala', 'player-sem-ficha');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toMatch(/criar-personagem/);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('chama o provedor de LLM e responde com a narração', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('sinaliza "digitando" no canal enquanto aguarda a resposta do LLM', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message.channel.sendTyping).toHaveBeenCalled();
  });

  it('não deixa uma falha ao sinalizar "digitando" impedir a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    message.channel.sendTyping.mockRejectedValue(new Error('sem permissão'));
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('passa as tools fazer_teste e consultar_ficha para o provedor', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(['fazer_teste', 'consultar_ficha']);
  });

  it('atualiza o resumo da sessão após a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.sessionSummary).toContain('sala empoeirada');
  });

  it('não deixa o erro do runTurn propagar e responde com mensagem amigável', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');

    await expect(handleMessage(message, pool, llmProvider, claudeClient)).resolves.toBeUndefined();

    expect(message._replies).toHaveLength(1);
    expect(message._replies[0]).not.toBe('Você vê uma sala empoeirada.');
    expect(message._replies[0]).toMatch(/mestre teve um problema/i);
  });

  it('não atualiza o resumo da sessão quando o runTurn falha', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');
    const campaignBefore = await getCampaignByChannel(pool, 'guild-1', 'channel-1');

    await handleMessage(message, pool, llmProvider, claudeClient);

    const campaignAfter = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaignAfter?.sessionSummary).toBe(campaignBefore?.sessionSummary);
  });

  it('em combate, recusa a ação quando não é o turno do autor', async () => {
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: ariaId, name: 'Aria', isNpc: false, characterId: ariaId, sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }) },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: createCharacterSheet(defaultRulesetConfig(), 'Goblin', { forca: 1, destreza: 1, intelecto: 1 }) },
      ],
      order: [
        { id: 'npc-1', name: 'Goblin', initiative: 15 },
        { id: ariaId, name: 'Aria', initiative: 10 },
      ],
      currentIndex: 0,
    });
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu ataco o goblin');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
    expect(message._replies[0]).toMatch(/não é sua vez/i);
    expect(message._replies[0]).toMatch(/goblin/i);
  });

  it('em combate, na vez do autor, chama o provedor de LLM com as tools de combate', async () => {
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: ariaId, name: 'Aria', isNpc: false, characterId: ariaId, sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }) },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: createCharacterSheet(defaultRulesetConfig(), 'Goblin', { forca: 1, destreza: 1, intelecto: 1 }) },
      ],
      order: [
        { id: ariaId, name: 'Aria', initiative: 15 },
        { id: 'npc-1', name: 'Goblin', initiative: 10 },
      ],
      currentIndex: 0,
    });
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockResolvedValue({ narration: 'Você ataca o goblin!', toolCalls: [] }),
    });
    const message = makeMessage('eu ataco o goblin');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você ataca o goblin!');
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fazer_teste', 'consultar_ficha', 'resolver_ataque', 'aplicar_dano', 'avancar_turno'])
    );
  });
});
