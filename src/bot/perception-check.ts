import type { CheckResult, ValidatedRulesetConfig } from '../rules-engine';
import { fazerTeste, type CharacterSheet, type Rng } from '../rules-engine';

/** DC de referência do teste de percepção (sucesso = total >= DC). */
export const PERCEPTION_DC = 12;

/** Nome do atributo usado no teste (assume 1–10 se ausente, como o resto do motor). */
export const PERCEPTION_ATTRIBUTE = 'percepção';

export type PerceptionTier = 'fraco' | 'moderado' | 'agudo' | 'excepcional';

export interface PerceptionCheckResult extends CheckResult {
  tier: PerceptionTier;
  attribute: string;
}

/**
 * Faixas por total (dX + atributo), independentes do LLM:
 * ≤10 fraco | 11–15 moderado | 16–19 agudo | 20+ excepcional
 */
export function perceptionTierFromTotal(total: number): PerceptionTier {
  if (total <= 10) return 'fraco';
  if (total <= 15) return 'moderado';
  if (total <= 19) return 'agudo';
  return 'excepcional';
}

export function rollPerceptionCheck(
  config: ValidatedRulesetConfig,
  sheet: CharacterSheet,
  rng: Rng = Math.random
): PerceptionCheckResult {
  const check = fazerTeste(config, sheet, PERCEPTION_ATTRIBUTE, PERCEPTION_DC, rng);
  return {
    ...check,
    attribute: PERCEPTION_ATTRIBUTE,
    tier: perceptionTierFromTotal(check.total),
  };
}

/** Linha compacta de mesa para o canal (antes da narração). */
export function formatPerceptionRollLine(check: PerceptionCheckResult, testDie: number): string {
  return `🎲 Percepção: **${check.total}** (d${testDie} ${check.roll} + ${check.attributeValue})`;
}
