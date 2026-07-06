import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel, updateSessionSummary, saveDraftProgress, activateCampaign } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';

describe('campaigns-repo', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('cria uma campanha e devolve os dados salvos', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    expect(campaign.id).toBeTruthy();
    expect(campaign.name).toBe('A Torre Esquecida');
    expect(campaign.status).toBe('active');
    expect(campaign.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
  });

  it('busca uma campanha por guildId + channelId', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const found = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(found?.name).toBe('A Torre Esquecida');
  });

  it('retorna null quando não há campanha no canal', async () => {
    const found = await getCampaignByChannel(pool, 'guild-1', 'channel-inexistente');
    expect(found).toBeNull();
  });

  it('cria campanha em status draft quando especificado', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Rascunho',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    expect(campaign.status).toBe('draft');
  });

  it('atualiza o resumo da sessão de uma campanha', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await updateSessionSummary(pool, campaign.id, 'Aria entrou na torre.');
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.sessionSummary).toBe('Aria entrou na torre.');
  });

  it('salva o documento de origem ao criar uma campanha', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      sourceDocument: 'texto do documento',
      status: 'draft',
    });
    expect(campaign.sourceDocument).toBe('texto do documento');
    expect(campaign.clarificationNotes).toBe('');
  });

  it('salva o progresso de um rascunho', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const updated = await saveDraftProgress(pool, campaign.id, {
      lore: 'Nova lore',
      rulesetConfig: { incompleto: true },
      clarificationNotes: 'O dado é d20.',
    });
    expect(updated.lore).toBe('Nova lore');
    expect(updated.clarificationNotes).toBe('O dado é d20.');
    expect(updated.status).toBe('draft');
  });

  it('ativa uma campanha em rascunho', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const activated = await activateCampaign(pool, campaign.id, {
      lore: 'Lore final',
      rulesetConfig: defaultRulesetConfig(),
    });
    expect(activated.status).toBe('active');
    expect(activated.lore).toBe('Lore final');
  });
});
