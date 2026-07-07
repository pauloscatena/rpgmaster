import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/iniciar-campanha';

function makeInteraction(channelId = 'channel-1') {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/iniciar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('trava e ativa uma campanha em rascunho', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/iniciada/i);
  });

  it('avisa que a campanha já está em andamento quando já é active', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/já está em andamento/i);
  });

  it('avisa para usar /retomar-campanha quando está pausada', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const { pauseCampaign } = await import('../../../src/db/campaigns-repo');
    await pauseCampaign(pool, campaign.id);
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/retomar-campanha/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
