export type {
  Rng,
  DieSize,
  ResourceDef,
  RulesetConfig,
  ValidatedRulesetConfig,
  CharacterSheet,
  InventoryItem,
  CharacterPower,
  Wallet,
  CurrencyNames,
  ClassDef,
  PowerDef,
} from './types';
export { rollDie } from './dice';
export {
  validateRulesetConfig,
  defaultRulesetConfig,
  coerceRulesetConfig,
  RulesetConfigSchema,
} from './ruleset-config';
export {
  createCharacterSheet,
  resolveAttributeValue,
  rollAssumedAttribute,
  ASSUMED_ATTRIBUTE_MIN,
  ASSUMED_ATTRIBUTE_MAX,
} from './character';
export { defaultShortName } from './character-names';
export { fazerTeste, type CheckResult } from './checks';
export { resolverAtaque, aplicarDano, verificarFimDeCombate, type AttackResult, type CombatOutcome } from './combat';
export { calcularIniciativa, avancarTurno, turnoAtual, type Combatant, type CombatState } from './turn';
export {
  usedSlots,
  canFit,
  findItem,
  addItem,
  removeItem,
  transferItem,
  normalizeInventory,
} from './inventory';
export {
  MINOR_PER_MAJOR,
  MAX_MAJOR_DELTA_ABS_PER_ADJUST,
  MAX_MINOR_DELTA_ABS_PER_ADJUST,
  normalizeWallet,
  totalMinor,
  applyWalletDelta,
  formatWallet,
} from './wallet';
export {
  learnPowerCost,
  powerLevelCost,
  attributeBumpCost,
  spendLearnPower,
  spendEvolvePower,
  spendEvolveAttribute,
} from './evolution';
export {
  MAX_XP_PER_MASTER_GRANT,
  MASTER_GRANT_COOLDOWN_MESSAGES,
  MAX_MASTER_GRANTS_PER_CHARACTER,
  canMasterGrant,
  validateMasterXpAmount,
  validateGrantReason,
} from './master-grants';
export {
  FALLBACK_CURRENCY_NAMES,
  pickCurrencyNames,
  inferEconomyEnabled,
  resolveCurrencyNames,
} from './currency-names';
