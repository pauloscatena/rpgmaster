import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

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
  config: RulesetConfig,
  participants: { id: string; name: string; character: CharacterSheet }[],
  rng: Rng = Math.random
): CombatState {
  const rolled: Combatant[] = participants.map((p) => ({
    id: p.id,
    name: p.name,
    initiative: rollDie(config.testDie, rng) + p.character.attributes[config.attackAttribute],
  }));
  rolled.sort((a, b) => b.initiative - a.initiative);
  return { order: rolled, currentIndex: 0 };
}

export function avancarTurno(state: CombatState): CombatState {
  const nextIndex = (state.currentIndex + 1) % state.order.length;
  return { ...state, currentIndex: nextIndex };
}

export function turnoAtual(state: CombatState): Combatant {
  return state.order[state.currentIndex];
}
