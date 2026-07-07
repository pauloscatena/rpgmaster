import { describe, it, expect } from 'vitest';
import { splitDiscordMessage } from '../../src/bot/discord-text';

describe('splitDiscordMessage', () => {
  it('devolve o texto inteiro como "first" e "rest" vazio quando já cabe no limite', () => {
    const text = 'Mensagem curta.';
    expect(splitDiscordMessage(text)).toEqual({ first: text, rest: [] });
  });

  it('divide um texto longo em pedaços de no máximo o tamanho limite', () => {
    const paragraph = 'a'.repeat(100) + '\n\n';
    const text = paragraph.repeat(30); // bem acima de 2000 caracteres
    const { first, rest } = splitDiscordMessage(text, 500);
    expect(rest.length).toBeGreaterThan(0);
    for (const chunk of [first, ...rest]) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it('não perde nenhum caractere de conteúdo ao dividir', () => {
    const paragraph = 'linha de texto de exemplo com conteúdo relevante.\n\n';
    const text = paragraph.repeat(50);
    const { first, rest } = splitDiscordMessage(text, 300);
    // remonta ignorando espaços de borda que o split pode ajustar entre pedaços
    const rejoined = [first, ...rest].join('\n\n');
    expect(rejoined.replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
  });

  it('prefere quebrar em uma linha em branco (parágrafo) antes do limite', () => {
    const text = 'primeiro parágrafo curto.\n\n' + 'x'.repeat(40);
    const { first } = splitDiscordMessage(text, 30);
    expect(first).toBe('primeiro parágrafo curto.');
  });

  it('quebra em uma quebra de linha simples quando não há parágrafo disponível', () => {
    const text = 'linha um\nlinha dois que é mais longa que o limite total permitido aqui';
    const { first } = splitDiscordMessage(text, 20);
    expect(first).toBe('linha um');
  });

  it('faz um corte forçado quando não há nenhuma quebra de linha disponível dentro do limite', () => {
    const text = 'x'.repeat(50);
    const { first, rest } = splitDiscordMessage(text, 20);
    expect(first.length).toBe(20);
    expect([first, ...rest].join('')).toBe(text);
  });
});
