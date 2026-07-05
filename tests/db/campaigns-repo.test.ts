import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
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
});
