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

  it('assume 1..10 e persiste na ficha quando o atributo não existe', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    // rng constante 0.5: assume = 6, depois d20 = 11
    const result = fazerTeste(config, sheet, 'percepção', 10, () => 0.5);
    expect(result.attributeValue).toBe(6);
    expect(result.roll).toBe(11);
    expect(result.total).toBe(17);
    expect(sheet.attributes.percepção).toBe(6);
    expect(result.success).toBe(true);
  });

  it('não lança erro quando o atributo está ausente', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    expect(() => fazerTeste(config, sheet, 'carisma', 10, () => 0.5)).not.toThrow();
  });
});
