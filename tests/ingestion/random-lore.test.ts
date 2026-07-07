import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { generateRandomLore } from '../../src/ingestion/random-lore';

function makeFakeClient(response: unknown): Anthropic {
  const create = vi.fn().mockResolvedValue(response);
  return { messages: { create } } as unknown as Anthropic;
}

describe('generateRandomLore', () => {
  it('devolve o texto do bloco de resposta, sem espaços nas pontas', async () => {
    const client = makeFakeClient({
      content: [{ type: 'text', text: '  Um reino esquecido desperta.  ' }],
    });
    const lore = await generateRandomLore(client);
    expect(lore).toBe('Um reino esquecido desperta.');
  });

  it('lança erro quando o modelo não devolve um bloco de texto', async () => {
    const client = makeFakeClient({ content: [] });
    await expect(generateRandomLore(client)).rejects.toThrow(/lore/i);
  });
});
