import { fazerTeste, type CheckResult } from './checks';
import { rollDie } from './dice';
import type { CharacterSheet, Rng, ValidatedRulesetConfig } from './types';

export interface AttackResult {
  check: CheckResult;
  hit: boolean;
  damage: number;
}

export function resolverAtaque(
  config: ValidatedRulesetConfig,
  attacker: CharacterSheet,
  rng: Rng = Math.random
): AttackResult {
  const check = fazerTeste(config, attacker, config.attackAttribute, config.defenseValue, rng);
  if (!check.success) {
    return { check, hit: false, damage: 0 };
  }
  const damageRoll = rollDie(config.damageDie, rng);
  const attackAttributeValue = attacker.attributes[config.attackAttribute];
  if (attackAttributeValue === undefined) {
    throw new Error(`A ficha de "${attacker.name}" não tem o atributo "${config.attackAttribute}"`);
  }
  const damage = damageRoll + attackAttributeValue;
  return { check, hit: true, damage };
}

export function aplicarDano(
  config: ValidatedRulesetConfig,
  defender: CharacterSheet,
  amount: number
): CharacterSheet {
  const current = defender.resources[config.hpResourceKey];
  if (current === undefined) {
    throw new Error(`A ficha de "${defender.name}" não tem o recurso "${config.hpResourceKey}"`);
  }
  const updated = Math.max(0, current - amount);
  return {
    ...defender,
    resources: { ...defender.resources, [config.hpResourceKey]: updated },
  };
}

export type CombatOutcome = 'jogadores' | 'inimigos' | null;

export function verificarFimDeCombate(
  config: ValidatedRulesetConfig,
  combatants: { isNpc: boolean; sheet: CharacterSheet }[]
): CombatOutcome {
  const isDown = (c: { sheet: CharacterSheet }) => (c.sheet.resources[config.hpResourceKey] ?? 0) <= 0;
  const npcs = combatants.filter((c) => c.isNpc);
  const players = combatants.filter((c) => !c.isNpc);
  if (npcs.length > 0 && npcs.every(isDown)) return 'jogadores';
  if (players.length > 0 && players.every(isDown)) return 'inimigos';
  return null;
}
