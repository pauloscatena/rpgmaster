import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel, updateRecentExchanges } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { saveCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import type { LlmProvider } from '../../src/llm/provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
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
      sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
    ariaId = aria.id;
  });

  function makeMessage(content: string, authorId = 'player-1', isBot = false) {
    const replies: string[] = [];
    const statusEdits: string[] = [];
    const statusMessage = {
      edit: vi.fn(async (text: string) => {
        statusEdits.push(text);
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    return {
      author: { id: authorId, bot: isBot },
      guildId: 'guild-1',
      channelId: 'channel-1',
      content,
      channel: {
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(async (text: string) => {
          statusEdits.push(text);
          return statusMessage;
        }),
      },
      reply: async (text: string) => {
        replies.push(text);
      },
      _replies: replies,
      _statusEdits: statusEdits,
      _statusMessage: statusMessage,
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
        sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
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
    expect(message.channel.send).toHaveBeenCalledTimes(1);
    expect(message._statusEdits[0]).toMatch(/pensando|runas|hipercarbonizando|destino|deuses|lore|d20|plot twist|biombo|grimório|dragões|NPC/i);
    expect(message._statusMessage.delete).toHaveBeenCalled();
  });

  it('renova typing e edita o status enquanto o LLM demora, depois limpa', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let resolveTurn!: (value: { narration: string; toolCalls: unknown[] }) => void;
      const llmProvider = makeLlmProvider({
        runTurn: vi.fn().mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveTurn = resolve;
            })
        ),
      });
      const message = makeMessage('eu examino a sala');
      const handlePromise = handleMessage(message, pool, llmProvider, claudeClient);

      await vi.waitFor(() => {
        expect(message.channel.sendTyping).toHaveBeenCalledTimes(1);
        expect(message.channel.send).toHaveBeenCalledTimes(1);
      });

      await vi.advanceTimersByTimeAsync(8_000);
      expect(message.channel.sendTyping).toHaveBeenCalledTimes(2);
      expect(message._statusMessage.edit).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(8_000);
      expect(message.channel.sendTyping).toHaveBeenCalledTimes(3);
      expect(message._statusMessage.edit).toHaveBeenCalledTimes(2);

      const statusShape = /_.+?\s(pensando|consultando runas|hipercarbonizando|rolando destino|barganhando com os deuses|desembaralhando a lore|calibrando o d20|invocando plot twist|sincronizando o biombo|decifrando o grimório|negociando com dragões|aquecendo o NPC)…_/;
      const first = message._statusEdits[0];
      const second = message._statusEdits[1];
      const third = message._statusEdits[2];
      expect(first).toMatch(statusShape);
      expect(second).toMatch(statusShape);
      expect(third).toMatch(statusShape);
      expect(second).not.toBe(first);
      expect(third).not.toBe(second);

      resolveTurn({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] });
      await handlePromise;
      expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
      expect(message._statusMessage.delete).toHaveBeenCalled();

      const callsAfterDone = message.channel.sendTyping.mock.calls.length;
      const editsAfterDone = message._statusMessage.edit.mock.calls.length;
      await vi.advanceTimersByTimeAsync(16_000);
      expect(message.channel.sendTyping).toHaveBeenCalledTimes(callsAfterDone);
      expect(message._statusMessage.edit).toHaveBeenCalledTimes(editsAfterDone);
    } finally {
      vi.useRealTimers();
    }
  });

  it('não deixa uma falha ao sinalizar "digitando" impedir a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    message.channel.sendTyping.mockRejectedValue(new Error('sem permissão'));
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('não deixa falha ao enviar status impedir a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    message.channel.send.mockRejectedValue(new Error('sem permissão'));
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('envia retorta irônica e segue o turno quando a mensagem tem palavrão', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu entro nessa porra de sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message.channel.send).toHaveBeenCalled();
    const firstSend = message.channel.send.mock.calls[0][0] as string;
    expect(firstSend).toMatch(/mãe|deuses|lore|bardo|dados|goblin|clérigo|grimório|dragão|troll|taverna|imprudência|sobrancelha|ancestrais|guilda/i);
    expect(llmProvider.runTurn).toHaveBeenCalled();
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('não envia retorta quando a mensagem não tem palavrão', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    // só o status de "digitando", não uma retorta prévia
    expect(message.channel.send).toHaveBeenCalledTimes(1);
    expect(message._statusEdits[0]).toMatch(/pensando|runas|hipercarbonizando|destino|deuses|lore|d20|plot twist|biombo|grimório|dragões|NPC/i);
  });

  it('passa as tools fazer_teste e consultar_ficha para o provedor', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fazer_teste', 'consultar_ficha', 'conceder_xp', 'conceder_poder'])
    );
    expect(toolsArg.map((t) => t.name)).not.toContain('ajustar_carteira');
  });

  it('acrescenta a troca ao buffer de curto prazo após a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.recentExchanges).toEqual([
      { characterName: 'Aria', playerMessage: 'eu examino a sala', narration: 'Você vê uma sala empoeirada.' },
    ]);
  });

  it('sanitiza tags <tools> da narração antes do reply e do buffer', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockResolvedValue({
        narration: 'Você vê uma sala empoeirada.\n\n<tools></tools>',
        toolCalls: [],
      }),
    });
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.recentExchanges?.[0]?.narration).toBe('Você vê uma sala empoeirada.');
  });

  it('não deixa o erro do runTurn propagar e responde com mensagem amigável', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');

    await expect(handleMessage(message, pool, llmProvider, claudeClient)).resolves.toBeUndefined();

    expect(message._replies).toHaveLength(1);
    expect(message._replies[0]).not.toBe('Você vê uma sala empoeirada.');
    expect(message._replies[0]).toMatch(/névoa da trama/i);
  });

  it('não acrescenta troca ao buffer quando o runTurn falha', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');
    const campaignBefore = await getCampaignByChannel(pool, 'guild-1', 'channel-1');

    await handleMessage(message, pool, llmProvider, claudeClient);

    const campaignAfter = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaignAfter?.recentExchanges).toEqual(campaignBefore?.recentExchanges);
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

  describe('reflexão narrativa periódica', () => {
    async function primeReflectionCounter(times: number) {
      for (let i = 0; i < times; i++) {
        await updateRecentExchanges(pool, campaignId, []);
      }
    }

    it('não dispara reflexão antes de atingir o limiar de mensagens', async () => {
      await primeReflectionCounter(8);
      const llmProvider = makeLlmProvider();
      const message = makeMessage('eu examino a sala');
      await handleMessage(message, pool, llmProvider, claudeClient);
      expect((llmProvider.runTurn as any).mock.calls.length).toBe(1);
    });

    it('dispara uma segunda chamada de reflexão ao atingir o limiar e persiste o estado', async () => {
      await primeReflectionCounter(9);
      const llmProvider: LlmProvider = {
        runTurn: vi
          .fn()
          .mockResolvedValueOnce({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] })
          .mockImplementationOnce(async (_system: string, _user: string, tools: ToolDefinition[], ctx: ToolContext) => {
            await tools[0]!.execute(
              { ritmo_atual: 'ação', proximo_marco: 'encontrar o goblin', fatos_cruciais: ['o rei está morto'] },
              ctx
            );
            return { narration: '', toolCalls: [] };
          }),
      };
      const message = makeMessage('eu examino a sala');
      await handleMessage(message, pool, llmProvider, claudeClient);
      expect((llmProvider.runTurn as any).mock.calls.length).toBe(2);
      const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
      expect(campaign?.ritmoAtual).toBe('ação');
      expect(campaign?.proximoMarco).toBe('encontrar o goblin');
    });

    it('não propaga erro nem impede a resposta quando a reflexão falha', async () => {
      await primeReflectionCounter(9);
      const llmProvider: LlmProvider = {
        runTurn: vi
          .fn()
          .mockResolvedValueOnce({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] })
          .mockRejectedValueOnce(new Error('boom')),
      };
      const message = makeMessage('eu examino a sala');
      await expect(handleMessage(message, pool, llmProvider, claudeClient)).resolves.toBeUndefined();
      expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
    });
  });
});
