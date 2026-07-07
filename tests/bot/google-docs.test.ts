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

import { extractTextFromTabs, type GoogleDocsTab } from '../../src/bot/google-docs';

describe('extractTextFromTabs', () => {
  it('extrai o texto de uma única guia com parágrafos', () => {
    const tabs: GoogleDocsTab[] = [
      {
        tabProperties: { title: 'Lore' },
        documentTab: {
          body: {
            content: [{ paragraph: { elements: [{ textRun: { content: 'Era uma vez um reino.' } }] } }],
          },
        },
      },
    ];
    expect(extractTextFromTabs(tabs)).toBe('=== Guia: Lore ===\nEra uma vez um reino.');
  });

  it('extrai o texto de múltiplas guias irmãs, na ordem em que aparecem', () => {
    const tabs: GoogleDocsTab[] = [
      {
        tabProperties: { title: 'Guia A' },
        documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Conteúdo A.' } }] } }] } },
      },
      {
        tabProperties: { title: 'Guia B' },
        documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Conteúdo B.' } }] } }] } },
      },
    ];
    const text = extractTextFromTabs(tabs);
    const indexA = text.indexOf('Guia A');
    const indexB = text.indexOf('Guia B');
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeGreaterThan(indexA);
    expect(text).toContain('Conteúdo A.');
    expect(text).toContain('Conteúdo B.');
  });

  it('extrai o texto de guias aninhadas (childTabs) recursivamente, sem perder conteúdo', () => {
    const tabs: GoogleDocsTab[] = [
      {
        tabProperties: { title: 'Guia Pai' },
        documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Texto pai.' } }] } }] } },
        childTabs: [
          {
            tabProperties: { title: 'Sub-guia' },
            documentTab: {
              body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Texto filho.' } }] } }] },
            },
          },
        ],
      },
    ];
    const text = extractTextFromTabs(tabs);
    expect(text).toContain('=== Guia: Guia Pai ===');
    expect(text).toContain('Texto pai.');
    expect(text).toContain('=== Guia: Sub-guia ===');
    expect(text).toContain('Texto filho.');
  });

  it('extrai o texto de células de tabela', () => {
    const tabs: GoogleDocsTab[] = [
      {
        tabProperties: { title: 'Regras' },
        documentTab: {
          body: {
            content: [
              {
                table: {
                  tableRows: [
                    {
                      tableCells: [
                        { content: [{ paragraph: { elements: [{ textRun: { content: 'Célula 1' } }] } }] },
                        { content: [{ paragraph: { elements: [{ textRun: { content: 'Célula 2' } }] } }] },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    ];
    const text = extractTextFromTabs(tabs);
    expect(text).toContain('Célula 1');
    expect(text).toContain('Célula 2');
  });

  it('lida com guia sem documentTab (guia vazia) sem lançar erro', () => {
    const tabs: GoogleDocsTab[] = [{ tabProperties: { title: 'Vazia' } }];
    expect(extractTextFromTabs(tabs)).toBe('=== Guia: Vazia ===\n');
  });
});
