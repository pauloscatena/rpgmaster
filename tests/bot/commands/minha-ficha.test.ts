import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign } from '../../../src/db/campaigns-repo';
import { createCharacter } from '../../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/minha-ficha';

function makeInteraction(publico: boolean | null = null) {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: 'player-1' },
    options: { getBoolean: () => publico },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/minha-ficha execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 10 }, inventory: ['espada'] },
    });
  });

  it('mostra a ficha de forma efêmera por padrão', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.ephemeral).toBe(true);
    expect(interaction._lastReply.content).toMatch(/Aria/);
    expect(interaction._lastReply.content).toMatch(/forca: 3/);
    expect(interaction._lastReply.content).toMatch(/hp: 10/);
    expect(interaction._lastReply.content).toMatch(/espada/);
  });

  it('mostra a ficha publicamente quando publico=true', async () => {
    const interaction = makeInteraction(true);
    await execute(interaction, pool);
    expect(interaction._lastReply.ephemeral).toBe(false);
  });

  it('mostra "vazio" quando o inventário está vazio', async () => {
    const otherPool = createTestPool();
    const campaign = await createCampaign(otherPool, {
      guildId: 'guild-2',
      channelId: 'channel-2',
      name: 'Outra Campanha',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(otherPool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-2',
      sheet: { name: 'Bram', attributes: { forca: 2 }, resources: { hp: 8 }, inventory: [] },
    });
    const interaction = makeInteraction();
    (interaction as any).guildId = 'guild-2';
    (interaction as any).channelId = 'channel-2';
    (interaction as any).user = { id: 'player-2' };
    await execute(interaction, otherPool);
    expect(interaction._lastReply.content).toMatch(/vazio/i);
  });

  it('avisa quando o jogador não tem ficha nesta campanha', async () => {
    const interaction = makeInteraction();
    (interaction as any).user = { id: 'player-sem-ficha' };
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/criar-personagem/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction();
    (interaction as any).channelId = 'channel-sem-campanha';
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
