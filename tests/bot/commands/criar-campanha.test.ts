import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { execute } from '../../../src/bot/commands/criar-campanha';
import { getCampaignByChannel } from '../../../src/db/campaigns-repo';

function makeInteraction(overrides: { guildId?: string | null; channelId?: string; nome?: string } = {}) {
  const guildId = 'guildId' in overrides ? overrides.guildId : 'guild-1';
  const channelId = overrides.channelId ?? 'channel-1';
  const nome = overrides.nome ?? 'A Torre Esquecida';
  const replies: unknown[] = [];
  return {
    guildId,
    channelId,
    options: { getString: () => nome },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    _replies: replies,
  } as any;
}

describe('/criar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('cria uma campanha com o ruleset padrão quando o canal está livre', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.name).toBe('A Torre Esquecida');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
    expect(interaction._replies[0]).toContain('A Torre Esquecida');
  });

  it('recusa criar uma segunda campanha no mesmo canal', async () => {
    await execute(makeInteraction(), pool);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool);
    const reply = interaction2._replies[0] as { content: string };
    expect(reply.content).toMatch(/já existe/i);
  });

  it('recusa quando usado fora de um servidor', async () => {
    const interaction = makeInteraction({ guildId: null });
    await execute(interaction, pool);
    const reply = interaction._replies[0] as { content: string };
    expect(reply.content).toMatch(/servidor/i);
  });
});
