import { describe, it, expect } from 'vitest';
import { appendExchange } from '../../src/llm/short-term-memory';

describe('appendExchange', () => {
  it('acrescenta a troca ao buffer vazio', () => {
    const result = appendExchange([], { characterName: 'Aria', playerMessage: 'oi', narration: 'olá' });
    expect(result).toEqual([{ characterName: 'Aria', playerMessage: 'oi', narration: 'olá' }]);
  });

  it('mantém as trocas em ordem, acrescentando ao final', () => {
    const current = [{ characterName: 'Aria', playerMessage: 'a', narration: 'A' }];
    const result = appendExchange(current, { characterName: 'Aria', playerMessage: 'b', narration: 'B' });
    expect(result).toEqual([
      { characterName: 'Aria', playerMessage: 'a', narration: 'A' },
      { characterName: 'Aria', playerMessage: 'b', narration: 'B' },
    ]);
  });

  it('descarta as trocas mais antigas ao exceder o tamanho máximo', () => {
    const current = Array.from({ length: 5 }, (_, i) => ({
      characterName: 'Aria',
      playerMessage: `msg${i}`,
      narration: `narr${i}`,
    }));
    const result = appendExchange(current, { characterName: 'Aria', playerMessage: 'nova', narration: 'Nova' }, 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ characterName: 'Aria', playerMessage: 'msg1', narration: 'narr1' });
    expect(result[4]).toEqual({ characterName: 'Aria', playerMessage: 'nova', narration: 'Nova' });
  });
});
