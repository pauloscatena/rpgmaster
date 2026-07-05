import { fazerTeste, type CheckResult } from './checks';
import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

export interface AttackResult {
  check: CheckResult;
  hit: boolean;
  damage: number;
}

export function resolverAtaque(
  config: RulesetConfig,
  attacker: CharacterSheet,
  rng: Rng = Math.random
): AttackResult {
  const check = fazerTeste(config, attacker, config.attackAttribute, config.defenseValue, rng);
  if (!check.success) {
    return { check, hit: false, damage: 0 };
  }
  const damageRoll = rollDie(config.damageDie, rng);
  const damage = damageRoll + attacker.attributes[config.attackAttribute];
  return { check, hit: true, damage };
}

export function aplicarDano(config: RulesetConfig, defender: CharacterSheet, amount: number): CharacterSheet {
  const current = defender.resources[config.hpResourceKey];
  const updated = Math.max(0, current - amount);
  return {
    ...defender,
    resources: { ...defender.resources, [config.hpResourceKey]: updated },
  };
}
