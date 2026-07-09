import { resolveAttributeValue } from './character';
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
  const attributeValue = resolveAttributeValue(character, attribute, rng);
  const roll = rollDie(config.testDie, rng);
  const total = roll + attributeValue;
  return { roll, attributeValue, total, difficulty, success: total >= difficulty };
}
