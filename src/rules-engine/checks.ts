import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

export interface CheckResult {
  roll: number;
  attributeValue: number;
  total: number;
  difficulty: number;
  success: boolean;
}

export function fazerTeste(
  config: RulesetConfig,
  character: CharacterSheet,
  attribute: string,
  difficulty: number,
  rng: Rng = Math.random
): CheckResult {
  if (!(attribute in character.attributes)) {
    throw new Error(`A ficha de "${character.name}" não tem o atributo "${attribute}"`);
  }
  const roll = rollDie(config.testDie, rng);
  const attributeValue = character.attributes[attribute];
  const total = roll + attributeValue;
  return { roll, attributeValue, total, difficulty, success: total >= difficulty };
}
