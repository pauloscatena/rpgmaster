import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel, type Campaign } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { processDraftAnswer, formatDraftSummary } from '../../src/ingestion/draft-flow';
import * as ingestion from '../../src/ingestion/extract';

describe('processDraftAnswer', () => {
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
      lore: 'Lore original',
      sourceDocument: 'documento original',
      status: 'draft',
    });
  });

  async function getDraft(): Promise<Campaign> {
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    if (!campaign) throw new Error('campanha não encontrada no teste');
    return campaign;
  }

  it('nunca ativa a campanha, mesmo quando a extração fica completa e sem clarifyingQuestions', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    const updated = await getDraft();
    expect(updated.status).toBe('draft');
    expect(updated.lore).toBe('Lore atualizada');
  });

  it('acumula a resposta nas notas de esclarecimento', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    const updated = await getDraft();
    expect(updated.clarificationNotes).toBe('o dado de teste é d20');
  });

  it('a mensagem de retorno inclui o resumo da configuração e a chamada para /iniciar-campanha', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    const result = await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    expect(result.message).toMatch(/dado de teste: d20/i);
    expect(result.message).toMatch(/\/iniciar-campanha/);
  });

  it('a mensagem de retorno inclui as clarifyingQuestions quando existirem', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: ['A coluna X representa ataque ou defesa? Sugiro ataque.'],
    });
    const campaign = await getDraft();
    const result = await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    expect(result.message).toMatch(/coluna X representa ataque ou defesa/i);
  });
});

describe('formatDraftSummary', () => {
  it('lista todos os campos da rulesetConfig', () => {
    const campaign = {
      id: 'c1',
      guildId: 'g1',
      channelId: 'ch1',
      name: 'Minha Campanha',
      status: 'draft' as const,
      rulesetConfig: defaultRulesetConfig(),
      lore: 'Uma lore.',
      sessionSummary: '',
      sourceDocument: '',
      clarificationNotes: '',
    };
    const summary = formatDraftSummary(campaign, []);
    expect(summary).toMatch(/Minha Campanha/);
    expect(summary).toMatch(/Uma lore\./);
    expect(summary).toMatch(/Sistema Simplificado Padrão/);
    expect(summary).toMatch(/forca, destreza, intelecto/);
    expect(summary).toMatch(/d20/);
    expect(summary).toMatch(/\/iniciar-campanha/);
  });
});
