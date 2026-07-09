import type { CurrencyNames, Wallet } from './types';

export const MINOR_PER_MAJOR = 10;
export const MAX_MAJOR_DELTA_ABS_PER_ADJUST = 50;
export const MAX_MINOR_DELTA_ABS_PER_ADJUST = 99;

export function normalizeWallet(w: Wallet): Wallet {
  let major = Math.floor(w.major);
  let minor = Math.floor(w.minor);
  if (minor >= MINOR_PER_MAJOR) {
    const extra = Math.floor(minor / MINOR_PER_MAJOR);
    major += extra;
    minor -= extra * MINOR_PER_MAJOR;
  }
  while (minor < 0 && major > 0) {
    major -= 1;
    minor += MINOR_PER_MAJOR;
  }
  return { major, minor };
}

export function totalMinor(w: Wallet): number {
  const n = normalizeWallet(w);
  return n.major * MINOR_PER_MAJOR + n.minor;
}

export function applyWalletDelta(
  w: Wallet,
  majorDelta: number,
  minorDelta: number
): { ok: true; wallet: Wallet } | { ok: false; error: string } {
  if (!Number.isInteger(majorDelta) || !Number.isInteger(minorDelta)) {
    return { ok: false, error: 'Deltas devem ser inteiros.' };
  }
  if (majorDelta === 0 && minorDelta === 0) {
    return { ok: false, error: 'Informe um valor diferente de zero.' };
  }
  if (Math.abs(majorDelta) > MAX_MAJOR_DELTA_ABS_PER_ADJUST) {
    return { ok: false, error: `Delta de major máximo: ${MAX_MAJOR_DELTA_ABS_PER_ADJUST}.` };
  }
  if (Math.abs(minorDelta) > MAX_MINOR_DELTA_ABS_PER_ADJUST) {
    return { ok: false, error: `Delta de minor máximo: ${MAX_MINOR_DELTA_ABS_PER_ADJUST}.` };
  }
  const next = normalizeWallet({
    major: w.major + majorDelta,
    minor: w.minor + minorDelta,
  });
  if (next.major < 0 || next.minor < 0 || totalMinor(next) < 0) {
    return { ok: false, error: 'Saldo insuficiente.' };
  }
  return { ok: true, wallet: next };
}

export function formatWallet(w: Wallet, names: CurrencyNames): string {
  const n = normalizeWallet(w);
  if (n.major === 0 && n.minor === 0) return 'sem dinheiro';
  const parts: string[] = [];
  if (n.major > 0) parts.push(`${n.major} ${names.major}`);
  if (n.minor > 0) parts.push(`${n.minor} ${names.minor}`);
  return parts.join(' e ');
}
