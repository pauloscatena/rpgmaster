import { rollDie } from './dice';
import type { CharacterSheet, Rng, ValidatedRulesetConfig } from './types';

export interface CheckResult {
  roll: number;
  attributeValue: number;
  total: number;
  difficulty: number;
  success: boolean;
}

export function fazerTeste(
  config: ValidatedRulesetConfig,
  character: CharacterSheet,
  attribute: string,
  difficulty: number,
  rng: Rng = Math.random
): CheckResult {
  const attributeValue = character.attributes[attribute];
  if (attributeValue === undefined) {
    throw new Error(`A ficha de "${character.name}" não tem o atributo "${attribute}"`);
  }
  const roll = rollDie(config.testDie, rng);
  const total = roll + attributeValue;
  return { roll, attributeValue, total, difficulty, success: total >= difficulty };
}
