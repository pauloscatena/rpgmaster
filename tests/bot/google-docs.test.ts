import { describe, it, expect } from 'vitest';
import { extractGoogleDocId, InvalidGoogleDocsLinkError } from '../../src/bot/google-docs';

describe('extractGoogleDocId', () => {
  it('extrai o ID de um link padrão do Google Docs', () => {
    expect(extractGoogleDocId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe(
      '1AbCdEfGhIjKlMnOp'
    );
  });

  it('extrai o ID mesmo com parâmetros extras (ex: guia selecionada)', () => {
    expect(
      extractGoogleDocId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?tab=t.0')
    ).toBe('1AbCdEfGhIjKlMnOp');
  });

  it('lança InvalidGoogleDocsLinkError quando o link não é um link válido do Google Docs', () => {
    expect(() => extractGoogleDocId('https://example.com/not-a-doc')).toThrow(InvalidGoogleDocsLinkError);
  });

  it('lança InvalidGoogleDocsLinkError para uma string vazia', () => {
    expect(() => extractGoogleDocId('')).toThrow(InvalidGoogleDocsLinkError);
  });
});
