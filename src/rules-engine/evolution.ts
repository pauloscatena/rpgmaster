import type { CharacterPower, CharacterSheet, ValidatedRulesetConfig } from './types';

export const learnPowerCost = 15;

export function powerLevelCost(fromLevel: number): number {
  return 10 * fromLevel;
}

export function attributeBumpCost(current: number): number {
  return 5 * Math.max(1, current);
}

export type SpendResult =
  | { ok: true; sheet: CharacterSheet }
  | { ok: false; error: string };

function classPowerKeys(config: ValidatedRulesetConfig, classKey: string | null): string[] {
  if (!classKey) return [];
  return config.classes.find((c) => c.key === classKey)?.powerKeys ?? [];
}

export function spendLearnPower(
  config: ValidatedRulesetConfig,
  sheet: CharacterSheet,
  powerKey: string
): SpendResult {
  if (!config.evolutionEnabled) return { ok: false, error: 'Evolução desligada nesta campanha.' };
  if (!sheet.classKey) return { ok: false, error: 'Defina uma classe primeiro.' };
  const allowed = classPowerKeys(config, sheet.classKey);
  if (!allowed.includes(powerKey)) return { ok: false, error: 'Este poder não pertence à sua classe.' };
  if (sheet.powers.some((p) => p.powerKey === powerKey)) {
    return { ok: false, error: 'Você já conhece este poder.' };
  }
  if (sheet.xp < learnPowerCost) return { ok: false, error: `XP insuficiente (precisa de ${learnPowerCost}).` };
  const power: CharacterPower = { powerKey, level: 1 };
  return {
    ok: true,
    sheet: { ...sheet, xp: sheet.xp - learnPowerCost, powers: [...sheet.powers, power] },
  };
}

export function spendEvolvePower(
  config: ValidatedRulesetConfig,
  sheet: CharacterSheet,
  powerKey: string
): SpendResult {
  if (!config.evolutionEnabled) return { ok: false, error: 'Evolução desligada nesta campanha.' };
  const current = sheet.powers.find((p) => p.powerKey === powerKey);
  if (!current) return { ok: false, error: 'Você não conhece este poder.' };
  if (current.level >= 10) return { ok: false, error: 'Este poder já está no nível máximo (10).' };
  const cost = powerLevelCost(current.level);
  if (sheet.xp < cost) return { ok: false, error: `XP insuficiente (precisa de ${cost}).` };
  return {
    ok: true,
    sheet: {
      ...sheet,
      xp: sheet.xp - cost,
      powers: sheet.powers.map((p) => (p.powerKey === powerKey ? { ...p, level: p.level + 1 } : p)),
    },
  };
}

export function spendEvolveAttribute(
  config: ValidatedRulesetConfig,
  sheet: CharacterSheet,
  attribute: string
): SpendResult {
  if (!config.evolutionEnabled) return { ok: false, error: 'Evolução desligada nesta campanha.' };
  if (!config.attributes.includes(attribute)) {
    return { ok: false, error: `Atributo "${attribute}" inválido.` };
  }
  const current = sheet.attributes[attribute] ?? 0;
  const cost = attributeBumpCost(current);
  if (sheet.xp < cost) return { ok: false, error: `XP insuficiente (precisa de ${cost}).` };
  return {
    ok: true,
    sheet: {
      ...sheet,
      xp: sheet.xp - cost,
      attributes: { ...sheet.attributes, [attribute]: current + 1 },
    },
  };
}
