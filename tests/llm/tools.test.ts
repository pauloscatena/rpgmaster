import { describe, it, expect } from 'vitest';
import { fazerTesteTool, consultarFichaTool, type ToolContext } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import { createCharacter, getCharacterByPlayer, type StoredCharacter } from '../../src/db/characters-repo';
import { createTestPool } from '../../src/db/test-db';

describe('fazerTesteTool', () => {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  const ctx: ToolContext = { config, actingCharacter, rng: () => 0.5 };

  it('tem nome e schema de entrada corretos', () => {
    expect(fazerTesteTool.name).toBe('fazer_teste');
    expect(fazerTesteTool.inputSchema).toMatchObject({
      type: 'object',
      required: ['attribute', 'difficulty'],
    });
  });

  it('executa fazerTeste do motor de regras e devolve o resultado', async () => {
    const result = (await fazerTesteTool.execute({ attribute: 'forca', difficulty: 10 }, ctx)) as {
      total: number;
      success: boolean;
    };
    expect(result.total).toBe(14); // d20 rng=0.5 -> 11 + forca 3
    expect(result.success).toBe(true);
  });

  it('rejeita quando attribute não é uma string', async () => {
    await expect(fazerTesteTool.execute({ attribute: 123, difficulty: 10 }, ctx)).rejects.toThrow(
      /attribute/
    );
  });

  it('rejeita quando difficulty está ausente', async () => {
    await expect(fazerTesteTool.execute({ attribute: 'forca' }, ctx)).rejects.toThrow(/difficulty/);
  });

  it('rejeita quando difficulty não é um número', async () => {
    await expect(
      fazerTesteTool.execute({ attribute: 'forca', difficulty: 'dez' }, ctx)
    ).rejects.toThrow(/difficulty/);
  });

  it('persiste atributo assumido quando pool está no contexto', async () => {
    const pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('camp-1', 'guild-1', 'channel-1', 'Teste', 'active', '{}', '')`
    );
    const sparseSheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    const stored = await createCharacter(pool, {
      campaignId: 'camp-1',
      playerDiscordId: 'player-1',
      sheet: sparseSheet,
    });
    const toolCtx: ToolContext = { config, actingCharacter: stored, rng: () => 0.5, pool };
    const result = (await fazerTesteTool.execute({ attribute: 'percepção', difficulty: 10 }, toolCtx)) as {
      attributeValue: number;
    };
    expect(result.attributeValue).toBe(6);
    expect(stored.sheet.attributes.percepção).toBe(6);
    const found = await getCharacterByPlayer(pool, 'camp-1', 'player-1');
    expect(found?.sheet.attributes.percepção).toBe(6);
  });
});

describe('consultarFichaTool', () => {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  const ctx: ToolContext = { config, actingCharacter, rng: () => 0.5 };

  it('tem nome correto', () => {
    expect(consultarFichaTool.name).toBe('consultar_ficha');
  });

  it('devolve a ficha do personagem que está agindo (sem carteira se economia off)', async () => {
    const result = await consultarFichaTool.execute({}, ctx);
    expect(result).toMatchObject({
      name: sheet.name,
      shortName: sheet.shortName,
      attributes: sheet.attributes,
      resources: sheet.resources,
      xp: sheet.xp,
      powers: sheet.powers,
    });
    expect(result).not.toHaveProperty('wallet');
  });
});
