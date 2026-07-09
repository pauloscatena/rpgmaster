import { describe, it, expect } from 'vitest';
import {
  alignMemoryToActingCharacter,
  findLikelyPcAliases,
  rewritePcAliasesInText,
} from '../../src/llm/memory-name-align';

describe('memory-name-align', () => {
  it('detecta Ronaldo como alias quando seguido de verbo de ação', () => {
    const text = 'Ronaldo se aproxima cautelosamente das bolsas.';
    expect(findLikelyPcAliases(text, new Set(['tess']))).toEqual(['Ronaldo']);
  });

  it('reescreve Ronaldo → Tess na narração', () => {
    const input =
      'Ronaldo se aproxima das bolsas. Ronaldo decide colocar as bolsas de volta.';
    expect(rewritePcAliasesInText(input, 'Tess', 'Tess')).toBe(
      'Tess se aproxima das bolsas. Tess decide colocar as bolsas de volta.'
    );
  });

  it('alinha exchanges do PC atuante e fatos, sem tocar outros PCs', () => {
    const result = alignMemoryToActingCharacter({
      actingCharacterName: 'Tess',
      actingCharacterShortName: 'Tess',
      recentExchanges: [
        {
          characterName: 'Tess',
          playerMessage: '2',
          narration: 'Ronaldo decide colocar as bolsas de volta.',
        },
        {
          characterName: 'Aria',
          playerMessage: 'oi',
          narration: 'Ronaldo decide atacar. Aria observa.',
        },
      ],
      fatosCruciais: ['Ronaldo encontrou três mapas náuticos.'],
    });

    expect(result.recentExchanges[0]?.narration).toBe('Tess decide colocar as bolsas de volta.');
    expect(result.recentExchanges[1]?.narration).toContain('Ronaldo decide atacar');
    expect(result.fatosCruciais[0]).toBe('Tess encontrou três mapas náuticos.');
  });
});
