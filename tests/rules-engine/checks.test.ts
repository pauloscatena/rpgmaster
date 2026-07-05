import { describe, it, expect } from 'vitest';
import { fazerTeste } from '../../src/rules-engine/checks';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('fazerTeste', () => {
  const config = defaultRulesetConfig();
  const character = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });

  it('soma a rolagem ao valor do atributo', () => {
    const result = fazerTeste(config, character, 'forca', 10, () => 0.5); // d20 com rng=0.5 -> roll 11
    expect(result.roll).toBe(11);
    expect(result.attributeValue).toBe(3);
    expect(result.total).toBe(14);
  });

  it('marca sucesso quando total >= dificuldade', () => {
    const result = fazerTeste(config, character, 'forca', 14, () => 0.5);
    expect(result.success).toBe(true);
  });

  it('marca falha quando total < dificuldade', () => {
    const result = fazerTeste(config, character, 'forca', 15, () => 0.5);
    expect(result.success).toBe(false);
  });

  it('lança erro se o atributo não existir na ficha', () => {
    expect(() => fazerTeste(config, character, 'carisma', 10, () => 0.5)).toThrow(/carisma/);
  });
});
