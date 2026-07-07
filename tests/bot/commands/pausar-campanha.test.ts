import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel, activateCampaign } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/pausar-campanha';

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

describe('/pausar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('pausa uma campanha ativa', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('paused');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/pausada/i);
  });

  it('avisa que ainda não começou quando está em draft', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/ainda não começou/i);
  });

  it('avisa que já está pausada quando chamado de novo', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction1 = makeInteraction();
    await execute(interaction1, pool);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool);
    expect(interaction2._lastReply.content ?? interaction2._lastReply).toMatch(/já está pausada/i);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
