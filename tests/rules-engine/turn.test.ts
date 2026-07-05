import { describe, it, expect } from 'vitest';
import { calcularIniciativa, avancarTurno, turnoAtual } from '../../src/rules-engine/turn';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('calcularIniciativa', () => {
  const config = defaultRulesetConfig();
  const aria = createCharacterSheet(config, 'Aria', { forca: 5, destreza: 2, intelecto: 1 });
  const goblin = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });

  it('ordena os participantes por iniciativa decrescente', () => {
    const rolls = [0, 0.9]; // Aria: d20 rng=0 -> 1 + forca 5 = 6; Goblin: d20 rng=0.9 -> 19 + forca 1 = 20
    let i = 0;
    const rng = () => {
      const value = rolls[i++];
      if (value === undefined) {
        throw new Error('rng chamado mais vezes do que o esperado no teste');
      }
      return value;
    };
    const state = calcularIniciativa(
      config,
      [
        { id: 'p1', name: 'Aria', character: aria },
        { id: 'p2', name: 'Goblin', character: goblin },
      ],
      rng
    );
    expect(state.order.map((c) => c.id)).toEqual(['p2', 'p1']);
    expect(state.currentIndex).toBe(0);
  });
});

describe('avancarTurno e turnoAtual', () => {
  const config = defaultRulesetConfig();
  const aria = createCharacterSheet(config, 'Aria', { forca: 5, destreza: 2, intelecto: 1 });
  const goblin = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });
  const state = calcularIniciativa(
    config,
    [
      { id: 'p1', name: 'Aria', character: aria },
      { id: 'p2', name: 'Goblin', character: goblin },
    ],
    () => 0.5
  );

  it('turnoAtual retorna o combatente do índice atual', () => {
    expect(turnoAtual(state).id).toBeDefined();
  });

  it('avancarTurno avança para o próximo índice', () => {
    const next = avancarTurno(state);
    expect(next.currentIndex).toBe((state.currentIndex + 1) % state.order.length);
  });

  it('avancarTurno dá a volta para o início após o último combatente', () => {
    let current = state;
    for (let i = 0; i < current.order.length; i++) {
      current = avancarTurno(current);
    }
    expect(current.currentIndex).toBe(state.currentIndex);
  });

  it('avancarTurno lança erro quando o estado de combate não tem combatentes', () => {
    const emptyState = { order: [], currentIndex: 0 };
    expect(() => avancarTurno(emptyState)).toThrow(/Não há combatentes/);
  });

  it('turnoAtual lança erro quando o estado de combate não tem combatentes', () => {
    const emptyState = { order: [], currentIndex: 0 };
    expect(() => turnoAtual(emptyState)).toThrow(/Não há combatentes/);
  });
});
