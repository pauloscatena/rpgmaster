import { describe, it, expect } from 'vitest';
import { formatValidationIssues } from '../../src/ingestion/validation-messages';
import { validateRulesetConfig, defaultRulesetConfig } from '../../src/rules-engine';

describe('formatValidationIssues', () => {
  it('devolve lista vazia quando a validação passou', () => {
    const validation = validateRulesetConfig(defaultRulesetConfig());
    expect(formatValidationIssues(validation)).toEqual([]);
  });

  it('devolve uma mensagem para cada problema de validação, identificando o campo', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), attackAttribute: 'nao-existe' });
    const issues = formatValidationIssues(validation);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/atributo de ataque/i);
  });

  it('identifica campos totalmente ausentes com o rótulo amigável', () => {
    const { name, ...semNome } = defaultRulesetConfig() as any;
    const validation = validateRulesetConfig(semNome);
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => i.includes('nome do sistema'))).toBe(true);
  });

  it('inclui o índice para problemas em itens de uma lista', () => {
    const config = defaultRulesetConfig();
    const invalid = {
      ...config,
      resources: [{ ...config.resources[0], linkedAttribute: 'nao-existe' }],
    };
    const validation = validateRulesetConfig(invalid);
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => i.includes('recursos (0.linkedAttribute)'))).toBe(true);
  });
});
