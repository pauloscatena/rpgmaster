import { describe, it, expect } from 'vitest';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { learnPowerCost, powerLevelCost, spendLearnPower, spendEvolvePower } from '../../src/rules-engine/evolution';

describe('evolution', () => {
  const config = defaultRulesetConfig();

  it('curva de poder crescente', () => {
    expect(powerLevelCost(1)).toBe(10);
    expect(powerLevelCost(9)).toBe(90);
  });

  it('aprende poder gastando XP', () => {
    let sheet = createCharacterSheet(config, 'Tess', { forca: 3, destreza: 2, intelecto: 1 });
    sheet = { ...sheet, classKey: 'guerreiro', xp: 20 };
    const r = spendLearnPower(config, sheet, 'golpe_poderoso');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet.xp).toBe(20 - learnPowerCost);
    expect(r.sheet.powers[0]).toEqual({ powerKey: 'golpe_poderoso', level: 1 });
  });

  it('rejeita evolução desligada', () => {
    const off = { ...config, evolutionEnabled: false };
    const sheet = { ...createCharacterSheet(config, 'Tess', { forca: 3, destreza: 2, intelecto: 1 }), classKey: 'guerreiro', xp: 100 };
    expect(spendLearnPower(off as typeof config, sheet, 'golpe_poderoso').ok).toBe(false);
  });

  it('evolui poder até custo e rejeita nível 10', () => {
    let sheet = createCharacterSheet(config, 'Tess', { forca: 3, destreza: 2, intelecto: 1 });
    sheet = { ...sheet, classKey: 'guerreiro', xp: 1000, powers: [{ powerKey: 'golpe_poderoso', level: 9 }] };
    const r = spendEvolvePower(config, sheet, 'golpe_poderoso');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sheet.powers[0]!.level).toBe(10);
    expect(spendEvolvePower(config, r.sheet, 'golpe_poderoso').ok).toBe(false);
  });
});
