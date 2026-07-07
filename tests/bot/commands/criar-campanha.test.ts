import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../../src/db/test-db';
import { execute } from '../../../src/bot/commands/criar-campanha';
import { getCampaignByChannel } from '../../../src/db/campaigns-repo';
import * as ingestion from '../../../src/ingestion/extract';

function makeInteraction(
  overrides: {
    guildId?: string | null;
    channelId?: string;
    nome?: string;
    attachmentUrl?: string;
    attachmentName?: string;
  } = {}
) {
  const guildId = 'guildId' in overrides ? overrides.guildId : 'guild-1';
  const channelId = overrides.channelId ?? 'channel-1';
  const nome = overrides.nome ?? 'A Torre Esquecida';
  const attachmentUrl = overrides.attachmentUrl;
  const attachmentName = overrides.attachmentName ?? 'documento.txt';
  const replies: unknown[] = [];
  let editedReply: unknown;
  return {
    guildId,
    channelId,
    options: {
      getString: () => nome,
      getAttachment: () => (attachmentUrl ? { url: attachmentUrl, name: attachmentName } : null),
    },
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
    _replies: replies,
  } as any;
}

describe('/criar-campanha execute', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(() => {
    vi.restoreAllMocks();
    pool = createTestPool();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => 'Documento de exemplo com lore e regras.' })
    );
  });

  it('cria uma campanha ativa com o ruleset padrão quando não há documento', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
  });

  it('recusa criar uma segunda campanha no mesmo canal', async () => {
    await execute(makeInteraction(), pool, claudeClient);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool, claudeClient);
    const reply = interaction2._replies[0] as { content: string };
    expect(reply.content).toMatch(/já existe/i);
  });

  it('recusa quando usado fora de um servidor', async () => {
    const interaction = makeInteraction({ guildId: null });
    await execute(interaction, pool, claudeClient);
    const reply = interaction._replies[0] as { content: string };
    expect(reply.content).toMatch(/servidor/i);
  });

  it('ativa a campanha direto quando o documento gera uma extração completa e válida', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: {
        name: 'Sistema Caseiro',
        attributes: ['vigor', 'agilidade'],
        testDie: 20,
        resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
        hpResourceKey: 'hp',
        attackAttribute: 'vigor',
        damageDie: 6,
        defenseValue: 11,
      },
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(campaign?.lore).toBe('Uma torre antiga.');
  });

  it('responde com uma mensagem de erro amigável quando o processamento do documento falha', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockRejectedValue(new Error('O modelo não devolveu uma extração estruturada.'));
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    expect(interaction._lastReply).toMatch(/não consegui processar o documento/i);
    expect(interaction._lastReply).toMatch(/criar-campanha/);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });

  it('entra em rascunho e pergunta ao usuário quando a extração fica incompleta', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: { name: 'Sistema Caseiro' },
      clarifyingQuestions: ['Qual dado é usado nos testes?'],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(interaction._lastReply).toMatch(/qual dado é usado nos testes/i);
    expect(interaction._lastReply).toMatch(/responder-campanha/);
  });
});
