import { describe, it, expect } from 'vitest';
import { rollDie } from '../../src/rules-engine/dice';

describe('rollDie', () => {
  it('retorna 1 quando rng retorna 0', () => {
    expect(rollDie(20, () => 0)).toBe(1);
  });

  it('retorna o valor máximo quando rng retorna quase 1', () => {
    expect(rollDie(6, () => 0.999999)).toBe(6);
  });

  it('usa Math.random por padrão e fica dentro do intervalo', () => {
    const result = rollDie(20);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(20);
  });
});
