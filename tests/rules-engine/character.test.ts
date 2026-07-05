import { describe, it, expect } from 'vitest';
import { createCharacterSheet } from '../../src/rules-engine/character';
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

  it('lança erro se faltar valor de algum atributo', () => {
    expect(() => createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2 })).toThrow(
      /intelecto/
    );
  });
});
