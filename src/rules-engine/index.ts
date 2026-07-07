export type { Rng, DieSize, ResourceDef, RulesetConfig, ValidatedRulesetConfig, CharacterSheet } from './types';
export { rollDie } from './dice';
export { validateRulesetConfig, defaultRulesetConfig, RulesetConfigSchema } from './ruleset-config';
export { createCharacterSheet } from './character';
export { fazerTeste, type CheckResult } from './checks';
export { resolverAtaque, aplicarDano, verificarFimDeCombate, type AttackResult, type CombatOutcome } from './combat';
export { calcularIniciativa, avancarTurno, turnoAtual, type Combatant, type CombatState } from './turn';
