# Referência a Google Docs na criação de campanha — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir referenciar um Google Docs (incluindo todas as guias e sub-guias) como documento de origem em `/criar-campanha`, como alternativa ao anexo de arquivo já existente.

**Architecture:** Um novo módulo `src/bot/google-docs.ts` extrai o ID do documento a partir do link, autentica como conta de serviço via `google-auth-library`, chama a API do Google Docs v1 (`documents.get?includeTabsContent=true`) e percorre recursivamente a árvore de guias para produzir uma única string de texto (mesmo formato que `fetchAttachmentText` já produz). Essa string alimenta o pipeline de ingestão existente (`extractResolvedConfig`) sem nenhuma alteração nele. `criar-campanha.ts` ganha uma opção `link`, mutuamente exclusiva com o anexo `documento`.

**Tech Stack:** TypeScript, Node.js, `google-auth-library` (nova dependência), Vitest, discord.js.

## Global Constraints

- O documento de origem (anexo ou Google Docs) não tem formatação específica — nunca fazer parsing estrutural do conteúdo; toda interpretação de sentido é feita pela extração via Claude já existente (`extractResolvedConfig`). O módulo novo só extrai texto corrido, nunca interpreta lore/regras.
- `noUncheckedIndexedAccess: true` está ativo no `tsconfig.json` — qualquer acesso a índice de array/regex-match pode ser `undefined`; usar guards explícitos, nunca `!` sem justificativa.
- Nunca fazer parsing estrutural do link além da extração do ID (regex simples); nunca preservar formatação visual (tabelas viram texto corrido, sem alinhamento).
- Reaproveitar 100% do pipeline de ingestão existente — nenhuma mudança em `src/ingestion/extract.ts` ou `src/ingestion/draft-flow.ts`.
- `GOOGLE_SERVICE_ACCOUNT_KEY` é opcional — sua ausência nunca impede o bot de subir, só desativa a opção `link` com um erro claro no momento do uso.
- Toda mensagem de erro voltada ao usuário final é em português, seguindo o tom já usado no restante do bot.

---

### Task 1: Dependência `google-auth-library`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: pacote `google-auth-library` instalado e disponível para import (`import { JWT } from 'google-auth-library';`) nas próximas tasks.

- [ ] **Step 1: Adicionar a dependência ao `package.json`**

Editar a seção `dependencies` de `package.json` (ordem alfabética, como as demais):

```json
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.1",
    "discord.js": "^14.16.3",
    "dotenv": "^16.6.1",
    "google-auth-library": "^9.14.1",
    "openai": "^4.104.0",
    "pdf-parse": "^1.1.4",
    "pg": "^8.13.1",
    "zod": "^3.23.8"
  },
```

- [ ] **Step 2: Instalar**

Run: `npm install`
Expected: instala `google-auth-library` sem erros; `package-lock.json` é atualizado.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: adiciona dependência google-auth-library"
```

---

### Task 2: `src/bot/google-docs.ts` — extração do ID do link e erros customizados

**Files:**
- Create: `src/bot/google-docs.ts`
- Test: `tests/bot/google-docs.test.ts`

**Interfaces:**
- Consumes: nenhuma (função pura sobre string).
- Produces: `extractGoogleDocId(link: string): string` (lança `InvalidGoogleDocsLinkError` se o link não bater com o padrão), classes `InvalidGoogleDocsLinkError`, `GoogleDocsPermissionError`, `GoogleDocsNotFoundError` (todas `extends Error`, usadas pelas próximas tasks e por `criar-campanha.ts`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/bot/google-docs.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: FAIL — `Cannot find module '../../src/bot/google-docs'`.

- [ ] **Step 3: Implementar**

Criar `src/bot/google-docs.ts`:

```ts
export class InvalidGoogleDocsLinkError extends Error {
  constructor(link: string) {
    super(`Link inválido: "${link}" não parece ser um link válido do Google Docs.`);
    this.name = 'InvalidGoogleDocsLinkError';
  }
}

export class GoogleDocsPermissionError extends Error {
  constructor(serviceAccountEmail: string) {
    super(
      `Não tenho permissão para ler esse Google Docs. Compartilhe o documento com "${serviceAccountEmail}" como leitor e tente novamente.`
    );
    this.name = 'GoogleDocsPermissionError';
  }
}

export class GoogleDocsNotFoundError extends Error {
  constructor() {
    super('Documento não encontrado. Confira se o link do Google Docs está correto.');
    this.name = 'GoogleDocsNotFoundError';
  }
}

export function extractGoogleDocId(link: string): string {
  const match = link.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  const id = match?.[1];
  if (!id) {
    throw new InvalidGoogleDocsLinkError(link);
  }
  return id;
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/google-docs.ts tests/bot/google-docs.test.ts
git commit -m "feat: extração do ID de link do Google Docs"
```

---

### Task 3: `src/bot/google-docs.ts` — extração de texto da árvore de guias

**Files:**
- Modify: `src/bot/google-docs.ts`
- Test: `tests/bot/google-docs.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores além do arquivo já existente.
- Produces: tipo exportado `GoogleDocsTab` e função `extractTextFromTabs(tabs: GoogleDocsTab[]): string` — usada pela Task 4 (`fetchGoogleDocText`) para transformar a resposta da API em uma única string, prefixando cada guia com `=== Guia: <título> ===` e concatenando guias-filhas (`childTabs`) recursivamente, na ordem em que aparecem.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/bot/google-docs.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: FAIL — `extractTextFromTabs` e `GoogleDocsTab` não existem no módulo.

- [ ] **Step 3: Implementar**

Adicionar ao final de `src/bot/google-docs.ts` (mantendo o conteúdo da Task 2 acima):

```ts
interface GoogleDocsTextRun {
  content: string;
}

interface GoogleDocsParagraphElement {
  textRun?: GoogleDocsTextRun;
}

interface GoogleDocsParagraph {
  elements: GoogleDocsParagraphElement[];
}

interface GoogleDocsTableCell {
  content: GoogleDocsStructuralElement[];
}

interface GoogleDocsTableRow {
  tableCells: GoogleDocsTableCell[];
}

interface GoogleDocsTable {
  tableRows: GoogleDocsTableRow[];
}

interface GoogleDocsStructuralElement {
  paragraph?: GoogleDocsParagraph;
  table?: GoogleDocsTable;
}

export interface GoogleDocsTab {
  tabProperties: { title: string };
  documentTab?: { body: { content: GoogleDocsStructuralElement[] } };
  childTabs?: GoogleDocsTab[];
}

export interface GoogleDocsDocument {
  tabs?: GoogleDocsTab[];
}

function extractStructuralElementsText(elements: GoogleDocsStructuralElement[]): string {
  const parts: string[] = [];
  for (const element of elements) {
    if (element.paragraph) {
      const paragraphText = element.paragraph.elements.map((e) => e.textRun?.content ?? '').join('');
      parts.push(paragraphText);
    }
    if (element.table) {
      for (const row of element.table.tableRows) {
        for (const cell of row.tableCells) {
          parts.push(extractStructuralElementsText(cell.content));
        }
      }
    }
  }
  return parts.join('');
}

export function extractTextFromTabs(tabs: GoogleDocsTab[]): string {
  const sections: string[] = [];
  for (const tab of tabs) {
    const bodyContent = tab.documentTab?.body.content ?? [];
    const tabText = extractStructuralElementsText(bodyContent);
    sections.push(`=== Guia: ${tab.tabProperties.title} ===\n${tabText}`);
    if (tab.childTabs && tab.childTabs.length > 0) {
      sections.push(extractTextFromTabs(tab.childTabs));
    }
  }
  return sections.join('\n\n');
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: PASS (9 testes no total: 4 da Task 2 + 5 desta task).

- [ ] **Step 5: Commit**

```bash
git add src/bot/google-docs.ts tests/bot/google-docs.test.ts
git commit -m "feat: extração recursiva de texto das guias do Google Docs"
```

---

### Task 4: `src/bot/google-docs.ts` — `fetchGoogleDocText` (autenticação + busca)

**Files:**
- Modify: `src/bot/google-docs.ts`
- Test: `tests/bot/google-docs.test.ts`

**Interfaces:**
- Consumes: `extractGoogleDocId` e `extractTextFromTabs` (Tasks 2–3, mesmo arquivo), `JWT` de `google-auth-library` (Task 1).
- Produces: `fetchGoogleDocText(link: string, serviceAccountKeyJson: string): Promise<string>` — usada pela Task 6 em `criar-campanha.ts`, mesmo formato de retorno (`Promise<string>`) que `fetchAttachmentText`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/bot/google-docs.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: FAIL — `fetchGoogleDocText` não existe no módulo.

- [ ] **Step 3: Implementar**

Adicionar ao topo de `src/bot/google-docs.ts` o import, e ao final do arquivo a função:

```ts
import { JWT } from 'google-auth-library';
```

```ts
export async function fetchGoogleDocText(link: string, serviceAccountKeyJson: string): Promise<string> {
  const documentId = extractGoogleDocId(link);
  const credentials = JSON.parse(serviceAccountKeyJson) as { client_email: string; private_key: string };

  const jwtClient = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/documents.readonly'],
  });

  const { access_token: accessToken } = await jwtClient.authorize();
  if (!accessToken) {
    throw new Error('Falha ao autenticar com a conta de serviço do Google.');
  }

  const response = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 403) {
    throw new GoogleDocsPermissionError(credentials.client_email);
  }
  if (response.status === 404) {
    throw new GoogleDocsNotFoundError();
  }
  if (!response.ok) {
    throw new Error(`Falha ao buscar o documento do Google Docs (status ${response.status}).`);
  }

  const document = (await response.json()) as GoogleDocsDocument;
  return extractTextFromTabs(document.tabs ?? []);
}
```

Nota: `extractGoogleDocId(link)` é chamado antes de qualquer autenticação/fetch — por isso um link inválido nunca chega a chamar `fetch` (verificado no teste "propaga InvalidGoogleDocsLinkError... sem chamar fetch").

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/bot/google-docs.test.ts`
Expected: PASS (14 testes no total).

- [ ] **Step 5: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/bot/google-docs.ts tests/bot/google-docs.test.ts
git commit -m "feat: fetchGoogleDocText com autenticação de conta de serviço e tratamento de erros 403/404"
```

---

### Task 5: `Config` ganha `googleServiceAccountKey` opcional

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `Config.googleServiceAccountKey?: string` — string JSON já decodificada de base64 (não parseada; quem faz `JSON.parse` é `fetchGoogleDocText`, Task 4). Usado pela Task 6 (`index.ts` → `routeInteraction` → `criarCampanha.execute`).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `tests/config.test.ts` (dentro do `describe('loadConfig', ...)`):

```ts
  it('decodifica GOOGLE_SERVICE_ACCOUNT_KEY de base64 quando presente', () => {
    const jsonKey = JSON.stringify({ client_email: 'bot@example.iam.gserviceaccount.com', private_key: 'fake-key' });
    const encoded = Buffer.from(jsonKey, 'utf-8').toString('base64');
    const config = loadConfig({ ...claudeEnv, GOOGLE_SERVICE_ACCOUNT_KEY: encoded });
    expect(config.googleServiceAccountKey).toBe(jsonKey);
  });

  it('deixa googleServiceAccountKey indefinido quando GOOGLE_SERVICE_ACCOUNT_KEY não está definido', () => {
    const config = loadConfig(claudeEnv);
    expect(config.googleServiceAccountKey).toBeUndefined();
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `config.googleServiceAccountKey` é `undefined` quando deveria ser a string decodificada (primeiro teste falha).

- [ ] **Step 3: Implementar**

Editar `src/config.ts` — adicionar o campo à interface e a lógica de decodificação em `loadConfig`:

```ts
interface BaseConfig {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
  anthropicApiKey: string;
  googleServiceAccountKey?: string;
}
```

E dentro de `loadConfig`, logo após a validação de `anthropicApiKey` e antes da leitura de `llmProviderRaw`:

```ts
  const googleServiceAccountKeyRaw = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const googleServiceAccountKey = googleServiceAccountKeyRaw
    ? Buffer.from(googleServiceAccountKeyRaw, 'base64').toString('utf-8')
    : undefined;
```

E incluir `googleServiceAccountKey` nos dois `return` finais (branch `ollama` e branch `claude`):

```ts
    return {
      discordToken,
      discordClientId,
      databaseUrl,
      anthropicApiKey,
      googleServiceAccountKey,
      llmProvider: 'ollama',
      ollamaBaseUrl,
      ollamaModel,
    };
  }

  return { discordToken, discordClientId, databaseUrl, anthropicApiKey, googleServiceAccountKey, llmProvider: 'claude' };
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (todos os testes, incluindo os 2 novos e os já existentes — `toEqual` ignora chaves `undefined`, então os testes antigos continuam passando sem alteração).

- [ ] **Step 5: Documentar em `.env.example`**

Adicionar ao final de `.env.example`:

```
# Opcional: necessário apenas para referenciar documentos via Google Docs em /criar-campanha.
# JSON da chave da conta de serviço do Google, codificado em base64.
# Veja docs/superpowers/specs/2026-07-07-google-docs-campaign-reference-design.md para o setup completo.
GOOGLE_SERVICE_ACCOUNT_KEY=
```

- [ ] **Step 6: Rodar o typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config.test.ts .env.example
git commit -m "feat: adiciona GOOGLE_SERVICE_ACCOUNT_KEY opcional ao Config"
```

---

### Task 6: `/criar-campanha` — opção `link`, exclusividade mútua, wiring

**Files:**
- Modify: `src/bot/commands/criar-campanha.ts`
- Modify: `src/bot/interaction-router.ts`
- Modify: `src/index.ts`
- Test: `tests/bot/commands/criar-campanha.test.ts`

**Interfaces:**
- Consumes: `fetchGoogleDocText`, `InvalidGoogleDocsLinkError`, `GoogleDocsPermissionError`, `GoogleDocsNotFoundError` de `src/bot/google-docs.ts` (Tasks 2–4); `Config.googleServiceAccountKey` (Task 5).
- Produces: `criarCampanha.execute(interaction, pool, claudeClient, googleServiceAccountKey)` — assinatura com o novo 4º parâmetro `string | undefined`; `routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey)` — mesmo novo 4º parâmetro, repassado a todos os comandos que hoje recebem `claudeClient` (apenas `criar-campanha` precisa dele; os demais mantêm a assinatura atual).

- [ ] **Step 1: Escrever os testes que falham**

Editar `tests/bot/commands/criar-campanha.test.ts`. Primeiro, atualizar `makeInteraction` para aceitar `link` e devolver o valor certo em `getString`:

```ts
function makeInteraction(
  overrides: {
    guildId?: string | null;
    channelId?: string;
    nome?: string;
    attachmentUrl?: string;
    attachmentName?: string;
    link?: string;
  } = {}
) {
  const guildId = 'guildId' in overrides ? overrides.guildId : 'guild-1';
  const channelId = overrides.channelId ?? 'channel-1';
  const nome = overrides.nome ?? 'A Torre Esquecida';
  const attachmentUrl = overrides.attachmentUrl;
  const attachmentName = overrides.attachmentName ?? 'documento.txt';
  const link = overrides.link ?? null;
  const replies: unknown[] = [];
  const followUps: unknown[] = [];
  let editedReply: unknown;
  return {
    guildId,
    channelId,
    options: {
      getString: (name: string) => (name === 'link' ? link : nome),
      getAttachment: () => (attachmentUrl ? { url: attachmentUrl, name: attachmentName } : null),
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    deferReply: async () => {},
    editReply: async (payload: unknown) => {
      editedReply = payload;
    },
    followUp: async (payload: unknown) => {
      followUps.push(payload);
    },
    get _lastReply() {
      return editedReply ?? replies[replies.length - 1];
    },
    _replies: replies,
    _followUps: followUps,
  } as any;
}
```

Todas as chamadas existentes a `execute(interaction, pool, claudeClient)` no arquivo precisam de um 4º argumento. Substituir cada uma delas por `execute(interaction, pool, claudeClient, undefined)`, e adicionar os testes novos ao final do `describe`:

```ts
  it('recusa quando anexo e link são fornecidos juntos', async () => {
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt', link: 'https://docs.google.com/document/d/abc123/edit' });
    await execute(interaction, pool, claudeClient, 'chave-de-servico-fake');
    expect(interaction._replies[0].content).toMatch(/escolha apenas uma origem/i);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });

  it('responde com erro amigável quando link é fornecido mas a conta de serviço não está configurada', async () => {
    const interaction = makeInteraction({ link: 'https://docs.google.com/document/d/abc123/edit' });
    await execute(interaction, pool, claudeClient, undefined);
    expect(interaction._replies[0].content).toMatch(/não está disponível/i);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });

  it('cria a campanha em rascunho a partir de um link do Google Docs', async () => {
    const googleDocs = await import('../../../src/bot/google-docs');
    vi.spyOn(googleDocs, 'fetchGoogleDocText').mockResolvedValue('=== Guia: Lore ===\nUma torre antiga em várias guias.');
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Uma torre antiga em várias guias.',
      rulesetConfig: {
        name: 'Sistema Caseiro',
        attributes: ['vigor'],
        testDie: 20,
        resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
        hpResourceKey: 'hp',
        attackAttribute: 'vigor',
        damageDie: 6,
        defenseValue: 11,
      } as any,
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction({ link: 'https://docs.google.com/document/d/abc123/edit' });
    await execute(interaction, pool, claudeClient, 'chave-de-servico-fake');
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.lore).toBe('Uma torre antiga em várias guias.');
    expect(googleDocs.fetchGoogleDocText).toHaveBeenCalledWith(
      'https://docs.google.com/document/d/abc123/edit',
      'chave-de-servico-fake'
    );
  });

  it('responde com a mensagem específica quando o link do Google Docs é inválido', async () => {
    const googleDocs = await import('../../../src/bot/google-docs');
    vi.spyOn(googleDocs, 'fetchGoogleDocText').mockRejectedValue(
      new googleDocs.InvalidGoogleDocsLinkError('https://example.com/nao-e-doc')
    );
    const interaction = makeInteraction({ link: 'https://example.com/nao-e-doc' });
    await execute(interaction, pool, claudeClient, 'chave-de-servico-fake');
    expect(interaction._lastReply).toMatch(/link inválido/i);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });

  it('responde com a mensagem específica quando falta permissão no Google Docs', async () => {
    const googleDocs = await import('../../../src/bot/google-docs');
    vi.spyOn(googleDocs, 'fetchGoogleDocText').mockRejectedValue(
      new googleDocs.GoogleDocsPermissionError('rpgmaster-bot@projeto.iam.gserviceaccount.com')
    );
    const interaction = makeInteraction({ link: 'https://docs.google.com/document/d/abc123/edit' });
    await execute(interaction, pool, claudeClient, 'chave-de-servico-fake');
    expect(interaction._lastReply).toMatch(/rpgmaster-bot@projeto\.iam\.gserviceaccount\.com/);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign).toBeNull();
  });
```

No topo do arquivo de teste, adicionar o import de `vi` se ainda não usado dessa forma (já está: `import { describe, it, expect, beforeEach, vi } from 'vitest';`).

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: FAIL — assinatura de `execute` ainda tem 3 parâmetros; opção `link` não existe.

- [ ] **Step 3: Implementar `criar-campanha.ts`**

Substituir o conteúdo completo de `src/bot/commands/criar-campanha.ts`:

```ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig } from '../../rules-engine';
import { fetchAttachmentText, UnsupportedAttachmentError } from '../attachments';
import {
  fetchGoogleDocText,
  InvalidGoogleDocsLinkError,
  GoogleDocsPermissionError,
  GoogleDocsNotFoundError,
} from '../google-docs';
import { extractResolvedConfig } from '../../ingestion/extract';
import { formatDraftSummary } from '../../ingestion/draft-flow';
import { generateRandomLore } from '../../ingestion/random-lore';
import { splitDiscordMessage } from '../discord-text';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true))
  .addAttachmentOption((opt) =>
    opt.setName('documento').setDescription('Documento opcional com lore e/ou regras da campanha').setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName('link')
      .setDescription('Link de um Google Docs com a lore e/ou regras da campanha (alternativa ao anexo)')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic,
  googleServiceAccountKey: string | undefined
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const existing = await getCampaignByChannel(pool, guildId, channelId);
  if (existing) {
    await interaction.reply({ content: `Já existe uma campanha ativa neste canal: "${existing.name}".`, ephemeral: true });
    return;
  }
  const nome = interaction.options.getString('nome', true);
  const attachment = interaction.options.getAttachment('documento');
  const link = interaction.options.getString('link');

  if (attachment && link) {
    await interaction.reply({
      content: 'Escolha apenas uma origem para o documento da campanha: anexo ou link do Google Docs, não os dois.',
      ephemeral: true,
    });
    return;
  }

  if (link && !googleServiceAccountKey) {
    await interaction.reply({
      content:
        'A referência a Google Docs não está disponível no momento (conta de serviço não configurada). Envie o documento como anexo, ou tente novamente mais tarde.',
      ephemeral: true,
    });
    return;
  }

  if (!attachment && !link) {
    await interaction.deferReply();
    let lore: string;
    try {
      lore = await generateRandomLore(claudeClient);
    } catch (err) {
      console.error('Erro ao gerar lore aleatória:', err);
      lore = 'Uma aventura misteriosa espera para ser descoberta.';
    }
    const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig(), lore });
    await interaction.editReply(
      `Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.\n\n${lore}`
    );
    return;
  }

  await interaction.deferReply();

  try {
    const documentText = link
      ? await fetchGoogleDocText(link, googleServiceAccountKey as string) // link truthy implica googleServiceAccountKey definido (validado acima)
      : await fetchAttachmentText(attachment!.url, attachment!.name);
    const resolved = await extractResolvedConfig(claudeClient, documentText);
    const campaign = await createCampaign(pool, {
      guildId,
      channelId,
      name: nome,
      rulesetConfig: resolved.rulesetConfig,
      lore: resolved.lore,
      sourceDocument: documentText,
      status: 'draft',
    });
    const { first, rest } = splitDiscordMessage(formatDraftSummary(campaign, resolved.clarifyingQuestions));
    await interaction.editReply(first);
    for (const chunk of rest) {
      await interaction.followUp(chunk);
    }
    return;
  } catch (err) {
    if (err instanceof UnsupportedAttachmentError) {
      await interaction.editReply(err.message);
      return;
    }
    if (
      err instanceof InvalidGoogleDocsLinkError ||
      err instanceof GoogleDocsPermissionError ||
      err instanceof GoogleDocsNotFoundError
    ) {
      await interaction.editReply(err.message);
      return;
    }
    console.error('Erro ao processar documento da campanha:', err);
    await interaction.editReply(
      'Não consegui processar o documento da campanha. Tente novamente com `/criar-campanha`.'
    );
    return;
  }
}
```

- [ ] **Step 4: Atualizar `interaction-router.ts`**

Editar `src/bot/interaction-router.ts` — assinatura ganha o 4º parâmetro, repassado apenas para `criar-campanha`:

```ts
export async function routeInteraction(
  interaction: Interaction,
  pool: Pool,
  claudeClient: Anthropic,
  googleServiceAccountKey: string | undefined
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool, claudeClient, googleServiceAccountKey);
      return;
    }
```

(o restante do arquivo — `criar-personagem`, `iniciar-combate`, `responder-campanha`, `iniciar-campanha`, `pausar-campanha`, `retomar-campanha`, `minha-ficha`, e os dois `isModalSubmit` — permanece idêntico.)

- [ ] **Step 5: Atualizar `index.ts`**

Editar `src/index.ts`, linha 18 (a chamada a `routeInteraction`):

```ts
  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool, claudeClient, config.googleServiceAccountKey).catch((err) => {
      console.error('Erro ao processar interação:', err);
    });
  });
```

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: PASS (12 testes no total: 7 já existentes + 5 novos).

- [ ] **Step 7: Rodar a suíte completa e o typecheck**

Run: `npm test`
Expected: PASS, sem nenhum FAIL (todos os arquivos de teste do projeto).

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/bot/commands/criar-campanha.ts src/bot/interaction-router.ts src/index.ts tests/bot/commands/criar-campanha.test.ts
git commit -m "feat: opção link em /criar-campanha para referenciar Google Docs"
```

---

### Task 7: Verificação final, deploy no container e push

**Files:**
- Nenhum arquivo novo — apenas build, deploy e verificação.

**Interfaces:**
- Consumes: todas as tasks anteriores (1–6), já commitadas.
- Produces: bot rodando no container com a feature ativa; branch atualizada em `origin/main`.

- [ ] **Step 1: Rodar a suíte completa uma última vez**

Run: `npm test`
Expected: PASS, todos os arquivos verdes.

- [ ] **Step 2: Rodar o typecheck uma última vez**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rebuild e restart do container do bot**

Run: `docker compose build bot`
Expected: build concluído sem erros.

Run: `docker compose up -d bot`
Expected: container reiniciado.

- [ ] **Step 4: Verificar os logs do container**

Run: `docker logs rpgmaster-bot-1 --tail 50`
Expected: `Bot conectado como <tag>`, sem stack traces de erro.

- [ ] **Step 5: Push**

```bash
git push origin main
```

Expected: push aceito sem conflitos.

---

## Self-Review

**Cobertura da spec:** todas as seções do design (`docs/superpowers/specs/2026-07-07-google-docs-campaign-reference-design.md`) têm task correspondente — arquitetura/fluxo de dados (Tasks 2–4), config/credenciais (Task 5), mudança em `criar-campanha.ts` (Task 6), todos os erros do documento (link inválido, link+anexo juntos, credencial ausente, 403, 404, fallback genérico — todos com teste dedicado nas Tasks 2, 4 e 6), estratégia de testes (replicada task a task). Nenhuma seção da spec ficou sem task.

**Placeholders:** nenhum "TBD"/"implementar depois" encontrado; todo step de código tem o código completo, sem trechos abreviados ou comentários tipo "similar à task anterior".

**Consistência de tipos:** `fetchGoogleDocText(link: string, serviceAccountKeyJson: string): Promise<string>` (Task 4) é chamada com exatamente essa assinatura em `criar-campanha.ts` (Task 6); `GoogleDocsTab` (Task 3) é usado sem alteração de forma nas Tasks 4 e nos testes; `Config.googleServiceAccountKey?: string` (Task 5) é o mesmo tipo (`string | undefined`) do 4º parâmetro de `execute`/`routeInteraction` (Task 6) — sem descompasso de nome ou tipo entre tasks.
