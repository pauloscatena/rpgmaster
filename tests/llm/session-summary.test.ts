import { describe, it, expect } from 'vitest';
import { appendToSessionSummary } from '../../src/llm/session-summary';

describe('appendToSessionSummary', () => {
  it('concatena o resumo atual com o novo trecho', () => {
    const result = appendToSessionSummary('Início da aventura.', 'Aria: eu entro na sala.');
    expect(result).toBe('Início da aventura.\nAria: eu entro na sala.');
  });

  it('usa o novo trecho sozinho quando o resumo atual está vazio', () => {
    const result = appendToSessionSummary('', 'Aria: eu entro na sala.');
    expect(result).toBe('Aria: eu entro na sala.');
  });

  it('trunca mantendo apenas o final quando excede o tamanho máximo', () => {
    const current = 'a'.repeat(20);
    const result = appendToSessionSummary(current, 'b'.repeat(10), 15);
    expect(result.length).toBe(15);
    expect(result.endsWith('b'.repeat(10))).toBe(true);
  });
});
