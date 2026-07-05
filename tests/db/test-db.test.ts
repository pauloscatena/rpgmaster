import { describe, it, expect } from 'vitest';
import { createTestPool } from '../../src/db/test-db';

describe('createTestPool', () => {
  it('aplica a migração e permite inserir em campaigns', async () => {
    const pool = createTestPool();
    const result = await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('c1', 'g1', 'ch1', 'Teste', 'active', '{}', '')
       RETURNING id`
    );
    expect(result.rows[0].id).toBe('c1');
  });

  it('impede duas campanhas no mesmo guild_id + channel_id', async () => {
    const pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('c1', 'g1', 'ch1', 'Teste', 'active', '{}', '')`
    );
    await expect(
      pool.query(
        `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
         VALUES ('c2', 'g1', 'ch1', 'Outra', 'active', '{}', '')`
      )
    ).rejects.toThrow();
  });
});
