import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/responder-campanha';
import * as ingestion from '../../../src/ingestion/extract';

function makeInteraction(resposta: string) {
  const replies: unknown[] = [];
  let editedReply: unknown;
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    options: { getString: () => resposta },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    deferReply: async () => {},
    editReply: async (payload: unknown) => {
      editedReply = payload;
    },
    get _lastReply() {
      return editedReply ?? replies[replies.length - 1];
    },
  } as any;
}

describe('/responder-campanha execute', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      lore: 'Uma torre antiga.',
      sourceDocument: 'documento original',
      status: 'draft',
    });
  });

  it('recusa quando não há campanha em rascunho no canal', async () => {
    const otherPool = createTestPool();
    const interaction = makeInteraction('o dado é d20');
    await execute(interaction, otherPool, claudeClient);
    expect(interaction._lastReply.content).toMatch(/não há campanha em rascunho/i);
  });

  it('ativa a campanha quando a nova extração fica completa e válida', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: {
        name: 'Sistema Caseiro',
        attributes: ['vigor'],
        testDie: 20,
        resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
        hpResourceKey: 'hp',
        attackAttribute: 'vigor',
        damageDie: 6,
        defenseValue: 11,
      },
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction('o dado de teste é d20');
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(interaction._lastReply).toMatch(/pronta para jogar/i);
  });

  it('permanece em rascunho e acumula as notas quando ainda faltam informações', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: { name: 'Sistema Caseiro' },
      clarifyingQuestions: ['Qual é o dado de dano?'],
    });
    const interaction = makeInteraction('o dado de teste é d20');
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.clarificationNotes).toBe('o dado de teste é d20');
    expect(interaction._lastReply).toMatch(/qual é o dado de dano/i);
  });

  it('responde com uma mensagem de erro amigável e mantém o rascunho intacto quando a extração falha', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockRejectedValue(
      new Error('O modelo não devolveu uma extração estruturada.')
    );
    const interaction = makeInteraction('o dado de teste é d20');
    await execute(interaction, pool, claudeClient);
    expect(interaction._lastReply).toMatch(/não consegui processar/i);
    expect(interaction._lastReply).toMatch(/responder-campanha/);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.clarificationNotes).toBe('');
  });
});
