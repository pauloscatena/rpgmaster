import { describe, it, expect } from 'vitest';
import { fazerTesteTool, consultarFichaTool, type ToolContext } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

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
});

describe('consultarFichaTool', () => {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  const ctx: ToolContext = { config, actingCharacter, rng: () => 0.5 };

  it('tem nome correto', () => {
    expect(consultarFichaTool.name).toBe('consultar_ficha');
  });

  it('devolve a ficha do personagem que está agindo', async () => {
    const result = await consultarFichaTool.execute({}, ctx);
    expect(result).toEqual(sheet);
  });
});
