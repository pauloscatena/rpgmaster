import type { Rng } from './types';
import type { CurrencyNames } from './types';

export const FALLBACK_CURRENCY_NAMES: CurrencyNames = {
  major: 'moedas de ouro',
  minor: 'moedas de prata',
};

const CURRENCY_PAIRS: CurrencyNames[] = [
  { major: 'dracmas', minor: 'óbolos' },
  { major: 'coroas', minor: 'peniques' },
  { major: 'cristais', minor: 'lascas' },
  { major: 'maravedis', minor: 'ceitis' },
  { major: 'runas', minor: 'fragmentos' },
];

export function pickCurrencyNames(rng: Rng = Math.random): CurrencyNames {
  const idx = Math.floor(rng() * CURRENCY_PAIRS.length);
  return CURRENCY_PAIRS[idx] ?? FALLBACK_CURRENCY_NAMES;
}

/** Heurística simples: lore menciona comércio/moeda/preço? */
export function inferEconomyEnabled(lore: string): boolean {
  const t = lore.toLowerCase();
  const hints = [
    'comércio',
    'comercio',
    'mercador',
    'moeda',
    'ouro',
    'prata',
    'preço',
    'preco',
    'salário',
    'salario',
    'loja',
    'taverna',
    'comprar',
    'vender',
    'dracma',
    'economia',
  ];
  return hints.some((h) => t.includes(h));
}

export function resolveCurrencyNames(params: {
  economyEnabled: boolean;
  loreNames?: CurrencyNames | null;
  rng?: Rng;
}): CurrencyNames {
  if (!params.economyEnabled) return FALLBACK_CURRENCY_NAMES;
  if (params.loreNames?.major && params.loreNames?.minor) {
    return {
      major: params.loreNames.major.trim().slice(0, 40),
      minor: params.loreNames.minor.trim().slice(0, 40),
    };
  }
  return pickCurrencyNames(params.rng ?? Math.random);
}
