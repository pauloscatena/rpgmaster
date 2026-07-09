import { describe, it, expect } from 'vitest';
import {
  formatPerceptionRollLine,
  perceptionTierFromTotal,
  PERCEPTION_ATTRIBUTE,
  PERCEPTION_DC,
  rollPerceptionCheck,
} from '../../src/bot/perception-check';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';

describe('perception-check', () => {
  const config = defaultRulesetConfig();

  it('mapeia faixas de total para tiers', () => {
    expect(perceptionTierFromTotal(10)).toBe('fraco');
    expect(perceptionTierFromTotal(11)).toBe('moderado');
    expect(perceptionTierFromTotal(15)).toBe('moderado');
    expect(perceptionTierFromTotal(16)).toBe('agudo');
    expect(perceptionTierFromTotal(19)).toBe('agudo');
    expect(perceptionTierFromTotal(20)).toBe('excepcional');
  });

  it('rola d20 + atributo via fazerTeste com DC fixo', () => {
    const sheet = createCharacterSheet(config, 'Aria', {
      forca: 3,
      destreza: 2,
      intelecto: 1,
      [PERCEPTION_ATTRIBUTE]: 3,
    });
    // rng 0.5 -> d20 = 11; total = 14; tier moderado; success vs DC 12
    const result = rollPerceptionCheck(config, sheet, () => 0.5);
    expect(result.roll).toBe(11);
    expect(result.attributeValue).toBe(3);
    expect(result.total).toBe(14);
    expect(result.difficulty).toBe(PERCEPTION_DC);
    expect(result.success).toBe(true);
    expect(result.tier).toBe('moderado');
  });

  it('assume atributo ausente e grava na ficha', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    const result = rollPerceptionCheck(config, sheet, () => 0.5);
    expect(result.attributeValue).toBe(6);
    expect(sheet.attributes[PERCEPTION_ATTRIBUTE]).toBe(6);
    expect(result.tier).toBe('agudo'); // 11+6=17
  });

  it('formata linha de mesa com total, dado e atributo', () => {
    const line = formatPerceptionRollLine(
      {
        roll: 14,
        attributeValue: 3,
        total: 17,
        difficulty: 12,
        success: true,
        tier: 'agudo',
        attribute: PERCEPTION_ATTRIBUTE,
      },
      20
    );
    expect(line).toBe('🎲 Percepção: **17** (d20 14 + 3)');
  });
});
