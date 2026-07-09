import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel, pauseCampaign } from '../../../src/db/campaigns-repo';
import { createCharacter, getCharacterByPlayer } from '../../../src/db/characters-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/percepcao';
import { PERCEPTION_PLAYER_MESSAGE } from '../../../src/bot/campaign-turn';
import { PERCEPTION_ATTRIBUTE } from '../../../src/bot/perception-check';
import type { LlmProvider } from '../../../src/llm/provider';
import * as campaignTurn from '../../../src/bot/campaign-turn';
import * as perceptionCheck from '../../../src/bot/perception-check';

function makeInteraction(overrides: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  const edits: unknown[] = [];
  const follows: unknown[] = [];
  const channelSends: string[] = [];
  const statusEdits: string[] = [];
  const statusMessage = {
    edit: vi.fn(async (text: string) => {
      statusEdits.push(text);
    }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: 'player-1' },
    channel: {
      sendTyping: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(async (text: string) => {
        if (text.startsWith('_')) {
          statusEdits.push(text);
          return statusMessage;
        }
        channelSends.push(text);
        return { id: 'msg-narration' };
      }),
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: async (payload: unknown) => {
      edits.push(payload);
    },
    followUp: async (payload: unknown) => {
      follows.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
    get _edits() {
      return edits;
    },
    get _follows() {
      return follows;
    },
    get _channelSends() {
      return channelSends;
    },
    get _statusEdits() {
      return statusEdits;
    },
    get _statusMessage() {
      return statusMessage;
    },
    ...overrides,
  } as any;
}

describe('/percepcao execute', () => {
  let pool: Pool;

  function makeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
      runTurn: vi.fn().mockResolvedValue({
        narration: 'Você nota o cheiro de madeira úmida e três caminhos possíveis.',
        toolCalls: [],
      }),
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
    await createCharacter(pool, {
      campaignId: campaign!.id,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', {
        forca: 3,
        destreza: 2,
        intelecto: 1,
        [PERCEPTION_ATTRIBUTE]: 3,
      }),
    });
  });

  it('recusa fora de servidor', async () => {
    const interaction = makeInteraction({ guildId: null });
    await execute(interaction, pool, makeLlmProvider());
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/servidor/i);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction({ channelId: 'channel-sem-campanha' });
    await execute(interaction, pool, makeLlmProvider());
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });

  it('avisa quando a campanha está em rascunho', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-draft',
      name: 'Rascunho',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction({ channelId: 'channel-draft' });
    await execute(interaction, pool, makeLlmProvider());
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/iniciar-campanha/i);
  });

  it('avisa quando a campanha está pausada', async () => {
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    await pauseCampaign(pool, campaign!.id);
    const interaction = makeInteraction();
    await execute(interaction, pool, makeLlmProvider());
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/retomar-campanha/i);
  });

  it('pede personagem quando o jogador não tem ficha', async () => {
    const interaction = makeInteraction({ user: { id: 'player-sem-ficha' } });
    await execute(interaction, pool, makeLlmProvider());
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/criar-personagem/i);
  });

  it('rola percepção, mostra o resultado e dispara turno com tier', async () => {
    vi.spyOn(perceptionCheck, 'rollPerceptionCheck').mockReturnValue({
      roll: 14,
      attributeValue: 3,
      total: 17,
      difficulty: 12,
      success: true,
      tier: 'agudo',
      attribute: PERCEPTION_ATTRIBUTE,
    });
    const llmProvider = makeLlmProvider();
    const spy = vi.spyOn(campaignTurn, 'runActiveCampaignTurn');
    const interaction = makeInteraction();
    await execute(interaction, pool, llmProvider);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction._edits[0]).toBe('🎲 Percepção: **17** (d20 14 + 3)');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        playerMessage: PERCEPTION_PLAYER_MESSAGE,
        mode: 'perception',
        llmProvider,
        perceptionCheck: expect.objectContaining({
          total: 17,
          roll: 14,
          attributeValue: 3,
          tier: 'agudo',
          difficulty: 12,
          testDie: 20,
        }),
      })
    );
    expect(llmProvider.runTurn).toHaveBeenCalled();
    const [systemPrompt, userMessage] = (llmProvider.runTurn as any).mock.calls[0];
    expect(userMessage).toBe(PERCEPTION_PLAYER_MESSAGE);
    expect(systemPrompt).toMatch(/Modo percepção/i);
    expect(systemPrompt).toMatch(/tier "agudo"/i);
    expect(interaction._channelSends[0]).toMatch(/cheiro de madeira/i);
  });

  it('persiste atributo percepção quando estava ausente', async () => {
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    await createCharacter(pool, {
      campaignId: campaign!.id,
      playerDiscordId: 'player-2',
      sheet: createCharacterSheet(defaultRulesetConfig(), 'Borin', {
        forca: 2,
        destreza: 2,
        intelecto: 2,
      }),
    });
    vi.spyOn(perceptionCheck, 'rollPerceptionCheck').mockImplementation((_cfg, sheet) => {
      sheet.attributes[PERCEPTION_ATTRIBUTE] = 7;
      return {
        roll: 10,
        attributeValue: 7,
        total: 17,
        difficulty: 12,
        success: true,
        tier: 'agudo',
        attribute: PERCEPTION_ATTRIBUTE,
      };
    });
    const interaction = makeInteraction({ user: { id: 'player-2' } });
    await execute(interaction, pool, makeLlmProvider());

    const stored = await getCharacterByPlayer(pool, campaign!.id, 'player-2');
    expect(stored!.sheet.attributes[PERCEPTION_ATTRIBUTE]).toBe(7);
  });
});
