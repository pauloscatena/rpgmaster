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

  it('sugere as opções de dado válidas em vez de "Invalid input" quando testDie está errado', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), testDie: 7 });
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => /dado de teste.*d4, d6, d8, d10, d12, d20 ou d100/.test(i))).toBe(true);
    expect(issues.some((i) => i.toLowerCase().includes('invalid input'))).toBe(false);
  });

  it('sugere as opções de dado válidas quando testDie está totalmente ausente', () => {
    const { testDie, ...semTestDie } = defaultRulesetConfig() as any;
    const validation = validateRulesetConfig(semTestDie);
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => /dado de teste.*d4, d6, d8, d10, d12, d20 ou d100/.test(i))).toBe(true);
  });

  it('sugere as opções de dado válidas para damageDie', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), damageDie: 3 });
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => /dado de dano.*d4, d6, d8, d10, d12, d20 ou d100/.test(i))).toBe(true);
  });

  it('lista os atributos válidos quando attackAttribute não corresponde a nenhum', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), attackAttribute: 'nao-existe' });
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => i.includes('Escolha um destes: forca, destreza ou intelecto'))).toBe(true);
  });

  it('lista os recursos válidos quando hpResourceKey não corresponde a nenhum', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), hpResourceKey: 'nao-existe' });
    const issues = formatValidationIssues(validation);
    expect(issues.some((i) => i.includes('Escolha um destes: hp'))).toBe(true);
  });
});
