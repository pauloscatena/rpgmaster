import { rollDie } from './dice';
import type { CharacterSheet, Rng, ValidatedRulesetConfig } from './types';

export interface Combatant {
  id: string;
  name: string;
  initiative: number;
}

export interface CombatState {
  order: Combatant[];
  currentIndex: number;
}

export function calcularIniciativa(
  config: ValidatedRulesetConfig,
  participants: { id: string; name: string; character: CharacterSheet }[],
  rng: Rng = Math.random
): CombatState {
  const rolled: Combatant[] = participants.map((p) => {
    const attributeValue = p.character.attributes[config.attackAttribute];
    if (attributeValue === undefined) {
      throw new Error(`A ficha de "${p.character.name}" não tem o atributo "${config.attackAttribute}"`);
    }
    return {
      id: p.id,
      name: p.name,
      initiative: rollDie(config.testDie, rng) + attributeValue,
    };
  });
  rolled.sort((a, b) => b.initiative - a.initiative);
  return { order: rolled, currentIndex: 0 };
}

export function avancarTurno(state: CombatState): CombatState {
  if (state.order.length === 0) {
    throw new Error('Não há combatentes no estado de combate.');
  }
  const nextIndex = (state.currentIndex + 1) % state.order.length;
  return { ...state, currentIndex: nextIndex };
}

export function turnoAtual(state: CombatState): Combatant {
  if (state.order.length === 0) {
    throw new Error('Não há combatentes no estado de combate.');
  }
  const current = state.order[state.currentIndex];
  if (current === undefined) {
    throw new Error('Não há combatentes no estado de combate.');
  }
  return current;
}
