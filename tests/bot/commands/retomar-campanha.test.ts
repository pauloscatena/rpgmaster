import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel, pauseCampaign } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/retomar-campanha';

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

describe('/retomar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('retoma uma campanha pausada', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await pauseCampaign(pool, campaign.id);
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.status).toBe('active');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/em andamento|retomada/i);
  });

  it('avisa que já está em andamento quando já é active', async () => {
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

  it('avisa para usar /iniciar-campanha quando está em draft', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/iniciar-campanha/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
