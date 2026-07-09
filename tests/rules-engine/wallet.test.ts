import { describe, it, expect } from 'vitest';
import { applyWalletDelta, formatWallet, normalizeWallet } from '../../src/rules-engine/wallet';

describe('wallet', () => {
  it('normaliza minor >= 10', () => {
    expect(normalizeWallet({ major: 0, minor: 12 })).toEqual({ major: 1, minor: 2 });
  });

  it('debita quebrando major', () => {
    const r = applyWalletDelta({ major: 1, minor: 0 }, 0, -3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallet).toEqual({ major: 0, minor: 7 });
  });

  it('rejeita saldo negativo', () => {
    const r = applyWalletDelta({ major: 0, minor: 2 }, 0, -5);
    expect(r.ok).toBe(false);
  });

  it('formata omitindo zeros', () => {
    expect(formatWallet({ major: 3, minor: 0 }, { major: 'moedas de ouro', minor: 'moedas de prata' })).toBe(
      '3 moedas de ouro'
    );
    expect(formatWallet({ major: 0, minor: 0 }, { major: 'ouro', minor: 'prata' })).toBe('sem dinheiro');
  });
});
