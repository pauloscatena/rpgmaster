import { describe, it, expect } from 'vitest';
import { defaultShortName } from '../../src/rules-engine/character-names';

describe('defaultShortName', () => {
  it('pega o primeiro token de nome completo', () => {
    expect(defaultShortName('Tess Nightshade')).toBe('Tess');
  });

  it('mantém nome único', () => {
    expect(defaultShortName('Tess')).toBe('Tess');
  });

  it('trimma espaços', () => {
    expect(defaultShortName('  Aria Vale  ')).toBe('Aria');
  });
});
