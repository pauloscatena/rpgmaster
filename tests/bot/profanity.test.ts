import { describe, it, expect } from 'vitest';
import { detectProfanity, randomProfanityRetort, PROFANITY_RETORTS } from '../../src/bot/profanity';

describe('detectProfanity', () => {
  it('detecta palavrões comuns em PT-BR', () => {
    expect(detectProfanity('que porra é essa')).toBe(true);
    expect(detectProfanity('CARALHO')).toBe(true);
    expect(detectProfanity('caralho!')).toBe(true);
    expect(detectProfanity('isso é merda')).toBe(true);
    expect(detectProfanity('que merda')).toBe(true);
    expect(detectProfanity('vai se foder')).toBe(true);
    expect(detectProfanity('fdp')).toBe(true);
    expect(detectProfanity('filho da puta')).toBe(true);
    expect(detectProfanity('que bosta')).toBe(true);
    expect(detectProfanity('só cu')).toBe(true);
  });

  it('detecta máscaras leves com *', () => {
    expect(detectProfanity('p*rra')).toBe(true);
    expect(detectProfanity('merd*')).toBe(true);
    expect(detectProfanity('put*')).toBe(true);
  });

  it('não dispara por substring dentro de palavras inocentes', () => {
    expect(detectProfanity('documento')).toBe(false);
    expect(detectProfanity('escultura')).toBe(false);
    expect(detectProfanity('cubo')).toBe(false);
    expect(detectProfanity('culpa')).toBe(false);
    expect(detectProfanity('cultura')).toBe(false);
    expect(detectProfanity('discussao')).toBe(false);
    expect(detectProfanity('discussão')).toBe(false);
    expect(detectProfanity('faculdade')).toBe(false);
    expect(detectProfanity('leio o documento da campanha')).toBe(false);
    expect(detectProfanity('pego o cubo mágico')).toBe(false);
  });

  it('não marca outras palavras inocentes', () => {
    expect(detectProfanity('eu examino a sala')).toBe(false);
    expect(detectProfanity('porto seguro à frente')).toBe(false);
    expect(detectProfanity('mercado da cidade')).toBe(false);
    expect(detectProfanity('computador')).toBe(false);
    expect(detectProfanity('cura o aliado')).toBe(false);
    expect(detectProfanity('cacarejar do galo')).toBe(false);
  });
});

describe('randomProfanityRetort', () => {
  it('devolve uma frase da lista', () => {
    const retort = randomProfanityRetort(() => 0);
    expect(PROFANITY_RETORTS).toContain(retort);
  });

  it('respeita o rng para índice estável', () => {
    expect(randomProfanityRetort(() => 0)).toBe(PROFANITY_RETORTS[0]);
    const lastIndex = PROFANITY_RETORTS.length - 1;
    expect(randomProfanityRetort(() => 0.999)).toBe(PROFANITY_RETORTS[lastIndex]);
  });

  it('tem lista sarcástica e não vazia', () => {
    expect(PROFANITY_RETORTS.length).toBeGreaterThanOrEqual(10);
    for (const line of PROFANITY_RETORTS) {
      expect(line.length).toBeGreaterThan(10);
    }
  });
});
