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

import { fetchGoogleDocText, GoogleDocsPermissionError, GoogleDocsNotFoundError } from '../../src/bot/google-docs';
import { vi, afterEach } from 'vitest';

vi.mock('google-auth-library', () => ({
  JWT: vi.fn().mockImplementation(() => ({
    authorize: vi.fn().mockResolvedValue({ access_token: 'test-token' }),
  })),
}));

const fakeServiceAccountKey = JSON.stringify({
  client_email: 'rpgmaster-bot@projeto-teste.iam.gserviceaccount.com',
  private_key: 'chave-falsa-de-teste',
});

describe('fetchGoogleDocText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('busca e concatena o texto de todas as guias em caso de sucesso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tabs: [
            {
              tabProperties: { title: 'Guia 1' },
              documentTab: {
                body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Texto da guia 1.' } }] } }] },
              },
            },
          ],
        }),
      })
    );
    const text = await fetchGoogleDocText(
      'https://docs.google.com/document/d/abc123/edit',
      fakeServiceAccountKey
    );
    expect(text).toContain('=== Guia: Guia 1 ===');
    expect(text).toContain('Texto da guia 1.');
  });

  it('lança GoogleDocsPermissionError com o e-mail da conta de serviço quando a API devolve 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(
      fetchGoogleDocText('https://docs.google.com/document/d/abc123/edit', fakeServiceAccountKey)
    ).rejects.toThrow(GoogleDocsPermissionError);
    await expect(
      fetchGoogleDocText('https://docs.google.com/document/d/abc123/edit', fakeServiceAccountKey)
    ).rejects.toThrow(/rpgmaster-bot@projeto-teste\.iam\.gserviceaccount\.com/);
  });

  it('lança GoogleDocsNotFoundError quando a API devolve 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      fetchGoogleDocText('https://docs.google.com/document/d/abc123/edit', fakeServiceAccountKey)
    ).rejects.toThrow(GoogleDocsNotFoundError);
  });

  it('lança um erro genérico para outras falhas HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(
      fetchGoogleDocText('https://docs.google.com/document/d/abc123/edit', fakeServiceAccountKey)
    ).rejects.toThrow(/500/);
  });

  it('propaga InvalidGoogleDocsLinkError para um link inválido, sem chamar fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGoogleDocText('https://example.com/nao-e-doc', fakeServiceAccountKey)).rejects.toThrow(
      /Link inválido/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
