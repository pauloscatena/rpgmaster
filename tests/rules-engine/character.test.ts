import { describe, it, expect } from 'vitest';
import {
  createCharacterSheet,
  resolveAttributeValue,
  ASSUMED_ATTRIBUTE_MIN,
  ASSUMED_ATTRIBUTE_MAX,
} from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('createCharacterSheet', () => {
  const config = defaultRulesetConfig();

  it('cria a ficha com atributos e nome corretos', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.name).toBe('Aria');
    expect(sheet.attributes).toEqual({ forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.inventory).toEqual([]);
  });

  it('calcula o recurso vinculado somando o atributo ao valor inicial', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.resources.hp).toBe(13); // startingValue 10 + forca 3
  });

  it('preenche atributos ausentes com inteiro aleatório entre 1 e 10', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2 }, () => 0.5);
    expect(sheet.attributes.forca).toBe(3);
    expect(sheet.attributes.destreza).toBe(2);
    expect(sheet.attributes.intelecto).toBe(6); // floor(0.5 * 10) + 1
    expect(sheet.attributes.intelecto).toBeGreaterThanOrEqual(ASSUMED_ATTRIBUTE_MIN);
    expect(sheet.attributes.intelecto).toBeLessThanOrEqual(ASSUMED_ATTRIBUTE_MAX);
    expect(sheet.resources.hp).toBe(13); // startingValue 10 + forca 3
  });
});

describe('resolveAttributeValue', () => {
  it('sorteia 1..10, grava na ficha e não lança quando o atributo está ausente', () => {
    const character = {
      name: 'Aria',
      shortName: 'Aria',
      attributes: { forca: 3 } as Record<string, number>,
      resources: { hp: 13 },
      inventory: [],
      bagCapacity: 10,
      classKey: null,
      xp: 0,
      powers: [],
      wallet: { major: 0, minor: 0 },
      lastMasterGrantAtCampaignMessages: null,
    };
    const value = resolveAttributeValue(character, 'percepção', () => 0);
    expect(value).toBe(ASSUMED_ATTRIBUTE_MIN);
    expect(character.attributes.percepção).toBe(ASSUMED_ATTRIBUTE_MIN);

    const again = resolveAttributeValue(character, 'percepção', () => 0.99);
    expect(again).toBe(ASSUMED_ATTRIBUTE_MIN); // já persistido na ficha
  });

  it('cobre o limite superior da faixa assumida', () => {
    const character = {
      name: 'Aria',
      shortName: 'Aria',
      attributes: {} as Record<string, number>,
      resources: {},
      inventory: [],
      bagCapacity: 10,
      classKey: null,
      xp: 0,
      powers: [],
      wallet: { major: 0, minor: 0 },
      lastMasterGrantAtCampaignMessages: null,
    };
    expect(resolveAttributeValue(character, 'carisma', () => 0.999)).toBe(ASSUMED_ATTRIBUTE_MAX);
  });
});
