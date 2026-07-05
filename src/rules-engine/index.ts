export type { Rng, DieSize, ResourceDef, RulesetConfig, CharacterSheet } from './types';
export { rollDie } from './dice';
export { validateRulesetConfig, defaultRulesetConfig, RulesetConfigSchema } from './ruleset-config';
export { createCharacterSheet } from './character';
export { fazerTeste, type CheckResult } from './checks';
export { resolverAtaque, aplicarDano, type AttackResult } from './combat';
export { calcularIniciativa, avancarTurno, turnoAtual, type Combatant, type CombatState } from './turn';
