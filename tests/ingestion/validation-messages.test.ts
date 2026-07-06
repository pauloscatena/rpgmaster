import { describe, it, expect } from 'vitest';
import { formatValidationIssues } from '../../src/ingestion/validation-messages';
import { validateRulesetConfig, defaultRulesetConfig } from '../../src/rules-engine';

describe('formatValidationIssues', () => {
  it('devolve lista vazia quando a validação passou', () => {
    const validation = validateRulesetConfig(defaultRulesetConfig());
    expect(formatValidationIssues(validation)).toEqual([]);
  });

  it('devolve uma mensagem para cada problema de validação', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), attackAttribute: 'nao-existe' });
    const issues = formatValidationIssues(validation);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/configuração de regras incompleta/i);
  });
});
