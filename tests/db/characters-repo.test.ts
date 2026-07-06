import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCharacter, getCharacterByPlayer, getCharactersByCampaign, updateCharacterResources } from '../../src/db/characters-repo';
import type { CharacterSheet } from '../../src/rules-engine';

const ariaSheet: CharacterSheet = {
  name: 'Aria',
  attributes: { forca: 3, destreza: 2, intelecto: 1 },
  resources: { hp: 13 },
  inventory: [],
};

describe('characters-repo', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('camp-1', 'guild-1', 'channel-1', 'Teste', 'active', '{}', '')`
    );
  });

  it('cria um personagem e devolve a ficha salva', async () => {
    const stored = await createCharacter(pool, {
      campaignId: 'camp-1',
      playerDiscordId: 'player-1',
      sheet: ariaSheet,
    });
    expect(stored.id).toBeTruthy();
    expect(stored.sheet).toEqual(ariaSheet);
  });

  it('busca um personagem por jogador na campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    const found = await getCharacterByPlayer(pool, 'camp-1', 'player-1');
    expect(found?.sheet.name).toBe('Aria');
  });

  it('retorna null quando o jogador não tem personagem na campanha', async () => {
    const found = await getCharacterByPlayer(pool, 'camp-1', 'player-sem-ficha');
    expect(found).toBeNull();
  });

  it('impede dois personagens do mesmo jogador na mesma campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    await expect(
      createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet })
    ).rejects.toThrow();
  });

  it('lista todos os personagens de uma campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-2', sheet: { ...ariaSheet, name: 'Bram' } });
    const characters = await getCharactersByCampaign(pool, 'camp-1');
    expect(characters.map((c) => c.sheet.name).sort()).toEqual(['Aria', 'Bram']);
  });

  it('atualiza os recursos de um personagem', async () => {
    const stored = await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    const updated = await updateCharacterResources(pool, stored.id, { hp: 5 });
    expect(updated.sheet.resources).toEqual({ hp: 5 });
  });
});
