import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { saveCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import type { LlmProvider } from '../../src/llm/provider';

describe('handleMessage', () => {
  let pool: Pool;
  let campaignId: string;
  let ariaId: string;

  function makeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
      runTurn: vi.fn().mockResolvedValue({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] }),
      ...overrides,
    };
  }

  beforeEach(async () => {
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
      reply: async (text: string) => {
        replies.push(text);
      },
      _replies: replies,
    } as any;
  }

  it('ignora mensagens de outros bots', async () => {
    const llmProvider = makeLlmProvider();
    await handleMessage(makeMessage('oi', 'bot-1', true), pool, llmProvider);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('ignora mensagens em canais sem campanha ativa', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('oi');
    message.channelId = 'channel-sem-campanha';
    await handleMessage(message, pool, llmProvider);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('ignora mensagens em campanha com status draft', async () => {
    const llmProvider = makeLlmProvider();
    const draftCampaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-draft',
      name: 'Campanha em rascunho',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    // Give the author a character in this draft campaign so that, absent the
    // `campaign.status !== 'active'` guard, the handler would proceed all the
    // way to calling the LLM provider instead of stopping earlier for lack of
    // a character sheet.
    await createCharacter(pool, {
      campaignId: draftCampaign.id,
      playerDiscordId: 'player-1',
      sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
    });
    const message = makeMessage('oi');
    message.channelId = 'channel-draft';
    await handleMessage(message, pool, llmProvider);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('pede para criar personagem quando o autor não tem ficha na campanha', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala', 'player-sem-ficha');
    await handleMessage(message, pool, llmProvider);
    expect(message._replies[0]).toMatch(/criar-personagem/);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('chama o provedor de LLM e responde com a narração', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('passa as tools fazer_teste e consultar_ficha para o provedor', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(['fazer_teste', 'consultar_ficha']);
  });

  it('atualiza o resumo da sessão após a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.sessionSummary).toContain('sala empoeirada');
  });

  it('não deixa o erro do runTurn propagar e responde com mensagem amigável', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');

    await expect(handleMessage(message, pool, llmProvider)).resolves.toBeUndefined();

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

    await handleMessage(message, pool, llmProvider);

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
    await handleMessage(message, pool, llmProvider);
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
    await handleMessage(message, pool, llmProvider);
    expect(message._replies[0]).toBe('Você ataca o goblin!');
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fazer_teste', 'consultar_ficha', 'resolver_ataque', 'aplicar_dano', 'avancar_turno'])
    );
  });
});
