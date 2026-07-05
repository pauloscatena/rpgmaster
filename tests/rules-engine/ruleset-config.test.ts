import { describe, it, expect } from 'vitest';
import { validateRulesetConfig, defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('defaultRulesetConfig', () => {
  it('é válido segundo o próprio schema', () => {
    const result = validateRulesetConfig(defaultRulesetConfig());
    expect(result.success).toBe(true);
  });
});

describe('validateRulesetConfig', () => {
  const base = defaultRulesetConfig();

  it('aceita uma config válida', () => {
    const result = validateRulesetConfig(base);
    expect(result.success).toBe(true);
  });

  it('rejeita mais de 5 atributos', () => {
    const invalid = { ...base, attributes: ['a', 'b', 'c', 'd', 'e', 'f'] };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando attackAttribute não está na lista de atributos', () => {
    const invalid = { ...base, attackAttribute: 'nao-existe' };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando hpResourceKey não corresponde a nenhum recurso', () => {
    const invalid = { ...base, hpResourceKey: 'nao-existe' };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando linkedAttribute de um recurso não está na lista de atributos', () => {
    const invalid = {
      ...base,
      resources: [{ key: 'hp', label: 'Pontos de Vida', startingValue: 10, linkedAttribute: 'nao-existe' }],
    };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita testDie fora dos valores permitidos', () => {
    const invalid = { ...base, testDie: 7 };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });
});
