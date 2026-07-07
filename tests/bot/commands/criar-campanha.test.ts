import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../../src/db/test-db';
import { execute } from '../../../src/bot/commands/criar-campanha';
import { getCampaignByChannel } from '../../../src/db/campaigns-repo';
import * as ingestion from '../../../src/ingestion/extract';
import * as randomLore from '../../../src/ingestion/random-lore';

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
  const followUps: unknown[] = [];
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
    followUp: async (payload: unknown) => {
      followUps.push(payload);
    },
    get _lastReply() {
      return editedReply ?? replies[replies.length - 1];
    },
    _replies: replies,
    _followUps: followUps,
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
    vi.spyOn(randomLore, 'generateRandomLore').mockResolvedValue('Uma lore de teste.');
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

  it('sempre cria a campanha em rascunho quando há documento, mesmo com extração completa', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
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
      } as any,
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(campaign?.lore).toBe('Uma torre antiga.');
    expect(interaction._lastReply).toMatch(/Sistema Caseiro/);
    expect(interaction._lastReply).toMatch(/\/iniciar-campanha/);
  });

  it('inclui as clarifyingQuestions no resumo quando existirem', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
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
      } as any,
      clarifyingQuestions: ['Qual dado é usado nos testes? Sugiro d20.'],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(interaction._lastReply).toMatch(/qual dado é usado nos testes/i);
  });

  it('divide o resumo do rascunho em várias mensagens quando ultrapassa o limite do Discord', async () => {
    const muitasPerguntas = Array.from(
      { length: 40 },
      (_, i) => `Pergunta número ${i + 1} sobre um detalhe específico das regras do documento? Sugiro a opção A.`
    );
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
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
      } as any,
      clarifyingQuestions: muitasPerguntas,
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    expect(interaction._lastReply.length).toBeLessThanOrEqual(2000);
    expect(interaction._followUps.length).toBeGreaterThan(0);
    for (const chunk of interaction._followUps as string[]) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    const fullText = [interaction._lastReply, ...interaction._followUps].join('');
    expect(fullText).toContain('Pergunta número 1 ');
    expect(fullText).toContain('Pergunta número 40 ');
  });

  it('responde com uma mensagem de erro amigável quando o processamento do documento falha', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockRejectedValue(new Error('O modelo não devolveu uma extração estruturada.'));
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    expect(interaction._lastReply).toMatch(/não consegui processar o documento/i);
    expect(interaction._lastReply).toMatch(/criar-campanha/);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });

  it('responde com mensagem específica e não cria campanha quando o formato do anexo não é suportado', async () => {
    const extractSpy = vi.spyOn(ingestion, 'extractCampaignDocument');
    const interaction = makeInteraction({
      attachmentUrl: 'https://discord.example/regras.docx',
      attachmentName: 'regras.docx',
    });
    await execute(interaction, pool, claudeClient);
    expect(interaction._lastReply).toMatch(/formato.*não suportado/i);
    expect(interaction._lastReply).toMatch(/\.txt/);
    expect(interaction._lastReply).toMatch(/\.pdf/);
    expect(extractSpy).not.toHaveBeenCalled();
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });
});
