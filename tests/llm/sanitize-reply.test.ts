import { describe, it, expect } from 'vitest';
import { sanitizeMasterReply } from '../../src/llm/sanitize-reply';

describe('sanitizeMasterReply', () => {
  it('remove o caso reportado: narração terminando com <tools></tools>', () => {
    const input =
      'Tess avança pela sala empoeirada, a tocha tremeluzindo.\n\n<tools></tools>';
    expect(sanitizeMasterReply(input)).toBe(
      'Tess avança pela sala empoeirada, a tocha tremeluzindo.'
    );
  });

  it('remove bloco <tools> com conteúdo', () => {
    const input = 'Você escala o muro.\n<tools>\nfazer_teste\n</tools>\nO vento sopra.';
    expect(sanitizeMasterReply(input)).toBe('Você escala o muro.\n\nO vento sopra.');
  });

  it('remove <tool_call> e variantes', () => {
    expect(sanitizeMasterReply('Ok.<tool_call>x</tool_call>')).toBe('Ok.');
    expect(sanitizeMasterReply('Ok.</tool_call>')).toBe('Ok.');
    expect(sanitizeMasterReply('Ok.<tool_calls></tool_calls>')).toBe('Ok.');
    expect(sanitizeMasterReply('Ok.<function_call>{}</function_call>')).toBe('Ok.');
  });

  it('remove fence xml/tool com tags de ferramenta', () => {
    const input = [
      'A porta range.',
      '```xml',
      '<tools></tools>',
      '```',
      'Dentro há silêncio.',
    ].join('\n');
    expect(sanitizeMasterReply(input)).toBe('A porta range.\n\nDentro há silêncio.');
  });

  it('preserva narração limpa e faz trim', () => {
    expect(sanitizeMasterReply('  Você vê uma sala.  \n')).toBe('Você vê uma sala.');
  });

  it('não remove fences de código sem artefato de tool', () => {
    const input = 'Ele lê:\n```\nalguma runa\n```\nFim.';
    expect(sanitizeMasterReply(input)).toBe(input);
  });
});
