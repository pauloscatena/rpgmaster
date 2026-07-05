import type { DieSize, Rng } from './types';

export function rollDie(sides: DieSize, rng: Rng = Math.random): number {
  return Math.floor(rng() * sides) + 1;
}
