import { describe, it, expect } from 'vitest';
import * as RulesEngine from '../../src/rules-engine/index';

describe('rules-engine public API', () => {
  it('expõe todas as funções e validações usadas pelos planos seguintes', () => {
    expect(typeof RulesEngine.rollDie).toBe('function');
    expect(typeof RulesEngine.validateRulesetConfig).toBe('function');
    expect(typeof RulesEngine.defaultRulesetConfig).toBe('function');
    expect(typeof RulesEngine.createCharacterSheet).toBe('function');
    expect(typeof RulesEngine.fazerTeste).toBe('function');
    expect(typeof RulesEngine.resolverAtaque).toBe('function');
    expect(typeof RulesEngine.aplicarDano).toBe('function');
    expect(typeof RulesEngine.calcularIniciativa).toBe('function');
    expect(typeof RulesEngine.avancarTurno).toBe('function');
    expect(typeof RulesEngine.turnoAtual).toBe('function');
  });
});
