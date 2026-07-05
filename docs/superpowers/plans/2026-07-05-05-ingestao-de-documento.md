# Ingestão de Documento de Campanha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que `/criar-campanha` receba um documento (lore + regras caseiras); o Claude extrai lore e `ruleset_config` **uma única vez**, na criação; se a extração ficar incompleta ou inválida, a campanha entra em rascunho e o bot faz perguntas objetivas via `/responder-campanha` até fechar uma configuração válida — nunca a mecânica é interpretada "ao vivo" durante o jogo.

**Architecture:** A extração usa uma chamada à Anthropic SDK com uma única tool forçada (`tool_choice`) que obriga o modelo a devolver `{ lore, rulesetConfig, clarifyingQuestions }` de forma estruturada, em vez de texto livre. O `rulesetConfig` extraído é validado com o mesmo `validateRulesetConfig` do Plano 1 usado em todo o resto do sistema. Enquanto a extração não estiver completa e válida, a campanha fica em `status: 'draft'` (bloqueada de uso em jogo pelos mesmos checks de `status !== 'active'` já existentes nos Planos 2-4) e o documento original + notas de esclarecimento acumuladas são reenviados numa nova extração a cada resposta do criador da campanha.

**Tech Stack:** `@anthropic-ai/sdk`, Node.js 20+ (fetch nativo), TypeScript, discord.js v14, Vitest.

## Global Constraints

- Depende dos Planos 1-4 já implementados.
- A extração do documento roda **uma única vez por tentativa**, sempre na criação/atualização do rascunho da campanha — nunca durante uma sessão de jogo em andamento.
- Uma campanha em rascunho (`status: 'draft'`) nunca é usada para jogar — todos os comandos e o handler de mensagens já recusam campanhas com `status !== 'active'` desde os Planos 2-4.
- O `rulesetConfig` extraído do documento é sempre validado com `validateRulesetConfig` (Plano 1) antes de ativar a campanha — nunca se confia numa config não validada.
- O mesmo limite de 5 atributos do Plano 1 vale para configs extraídos de documento.

---

## Estrutura de arquivos

```
RPGMaster/
  src/
    db/
      migrations/
        003_campaign_draft.sql
      campaigns-repo.ts          # MODIFICADO: sourceDocument, clarificationNotes, saveDraftProgress, activateCampaign
    bot/
      attachments.ts
      commands/
        criar-campanha.ts        # MODIFICADO: opção de documento + fluxo de rascunho
        responder-campanha.ts
      interaction-router.ts      # MODIFICADO: recebe claudeClient, despacha /responder-campanha
    ingestion/
      extract.ts
      validation-messages.ts
    index.ts                     # MODIFICADO: passa claudeClient para routeInteraction
  tests/
    db/
      campaigns-repo.test.ts     # MODIFICADO
    bot/
      attachments.test.ts
      interaction-router.test.ts # MODIFICADO
      commands/
        criar-campanha.test.ts   # MODIFICADO
        responder-campanha.test.ts
    ingestion/
      extract.test.ts
      validation-messages.test.ts
```

---

### Task 1: Migração de rascunho e extensão do repositório de campanhas

**Files:**
- Create: `src/db/migrations/003_campaign_draft.sql`
- Modify: `src/db/campaigns-repo.ts` (Plano 2, Task 2)
- Modify: `tests/db/campaigns-repo.test.ts` (Plano 2, Task 2)

**Interfaces:**
- Produces: `Campaign` ganha `sourceDocument: string` e `clarificationNotes: string`; `createCampaign` aceita `sourceDocument?: string`; `async function saveDraftProgress(pool: Pool, campaignId: string, params: { lore: string; rulesetConfig: unknown; clarificationNotes: string }): Promise<Campaign>`; `async function activateCampaign(pool: Pool, campaignId: string, params: { lore: string; rulesetConfig: RulesetConfig }): Promise<Campaign>`.

- [ ] **Step 1: Escrever testes falhos**

Adicionar ao final do `describe('campaigns-repo', ...)` em `tests/db/campaigns-repo.test.ts`, e importar `saveDraftProgress, activateCampaign` junto de `createCampaign, getCampaignByChannel` no topo do arquivo:
```ts
  it('salva o documento de origem ao criar uma campanha', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      sourceDocument: 'texto do documento',
      status: 'draft',
    });
    expect(campaign.sourceDocument).toBe('texto do documento');
    expect(campaign.clarificationNotes).toBe('');
  });

  it('salva o progresso de um rascunho', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const updated = await saveDraftProgress(pool, campaign.id, {
      lore: 'Nova lore',
      rulesetConfig: { incompleto: true },
      clarificationNotes: 'O dado é d20.',
    });
    expect(updated.lore).toBe('Nova lore');
    expect(updated.clarificationNotes).toBe('O dado é d20.');
    expect(updated.status).toBe('draft');
  });

  it('ativa uma campanha em rascunho', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const activated = await activateCampaign(pool, campaign.id, {
      lore: 'Lore final',
      rulesetConfig: defaultRulesetConfig(),
    });
    expect(activated.status).toBe('active');
    expect(activated.lore).toBe('Lore final');
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: FAIL — colunas e funções novas ainda não existem.

- [ ] **Step 3: Implementar**

`src/db/migrations/003_campaign_draft.sql`:
```sql
ALTER TABLE campaigns ADD COLUMN source_document TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN clarification_notes TEXT NOT NULL DEFAULT '';
```

Substituir `src/db/campaigns-repo.ts` inteiro por:
```ts
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { RulesetConfig } from '../rules-engine';

export type CampaignStatus = 'draft' | 'active';

export interface Campaign {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  status: CampaignStatus;
  rulesetConfig: RulesetConfig;
  lore: string;
  sessionSummary: string;
  sourceDocument: string;
  clarificationNotes: string;
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
    name: row.name as string,
    status: row.status as CampaignStatus,
    rulesetConfig: row.ruleset_config as RulesetConfig,
    lore: row.lore as string,
    sessionSummary: row.session_summary as string,
    sourceDocument: row.source_document as string,
    clarificationNotes: row.clarification_notes as string,
  };
}

export async function createCampaign(
  pool: Pool,
  params: {
    guildId: string;
    channelId: string;
    name: string;
    rulesetConfig: RulesetConfig;
    lore?: string;
    status?: CampaignStatus;
    sourceDocument?: string;
  }
): Promise<Campaign> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore, source_document)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      params.guildId,
      params.channelId,
      params.name,
      params.status ?? 'active',
      JSON.stringify(params.rulesetConfig),
      params.lore ?? '',
      params.sourceDocument ?? '',
    ]
  );
  return rowToCampaign(result.rows[0]);
}

export async function getCampaignByChannel(
  pool: Pool,
  guildId: string,
  channelId: string
): Promise<Campaign | null> {
  const result = await pool.query(`SELECT * FROM campaigns WHERE guild_id = $1 AND channel_id = $2`, [
    guildId,
    channelId,
  ]);
  return result.rows[0] ? rowToCampaign(result.rows[0]) : null;
}

export async function updateSessionSummary(pool: Pool, campaignId: string, sessionSummary: string): Promise<void> {
  await pool.query(`UPDATE campaigns SET session_summary = $2 WHERE id = $1`, [campaignId, sessionSummary]);
}

export async function saveDraftProgress(
  pool: Pool,
  campaignId: string,
  params: { lore: string; rulesetConfig: unknown; clarificationNotes: string }
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET lore = $2, ruleset_config = $3, clarification_notes = $4 WHERE id = $1 RETURNING *`,
    [campaignId, params.lore, JSON.stringify(params.rulesetConfig), params.clarificationNotes]
  );
  return rowToCampaign(result.rows[0]);
}

export async function activateCampaign(
  pool: Pool,
  campaignId: string,
  params: { lore: string; rulesetConfig: RulesetConfig }
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET lore = $2, ruleset_config = $3, status = 'active' WHERE id = $1 RETURNING *`,
    [campaignId, params.lore, JSON.stringify(params.rulesetConfig)]
  );
  return rowToCampaign(result.rows[0]);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: PASS (todos os testes do Plano 2/3 mais os 3 novos).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS em todos os Planos 1-4.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/003_campaign_draft.sql src/db/campaigns-repo.ts tests/db/campaigns-repo.test.ts
git commit -m "feat: add campaign draft fields and draft progress/activation queries"
```

---

### Task 2: Download de anexo do Discord

**Files:**
- Create: `src/bot/attachments.ts`
- Test: `tests/bot/attachments.test.ts`

**Interfaces:**
- Produces: `async function fetchAttachmentText(url: string): Promise<string>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/attachments.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAttachmentText } from '../../src/bot/attachments';

describe('fetchAttachmentText', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('baixa e devolve o texto do anexo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'conteúdo do documento' }));
    const text = await fetchAttachmentText('https://discord.example/doc.txt');
    expect(text).toBe('conteúdo do documento');
  });

  it('lança erro quando a resposta não é ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }));
    await expect(fetchAttachmentText('https://discord.example/doc.txt')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/attachments.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `attachments.ts`**

`src/bot/attachments.ts`:
```ts
export async function fetchAttachmentText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar o documento da campanha (status ${response.status}).`);
  }
  return response.text();
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/attachments.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/attachments.ts tests/bot/attachments.test.ts
git commit -m "feat: add discord attachment text download helper"
```

---

### Task 3: Extração estruturada via Claude e mensagens de validação

**Files:**
- Create: `src/ingestion/extract.ts`
- Create: `src/ingestion/validation-messages.ts`
- Test: `tests/ingestion/extract.test.ts`
- Test: `tests/ingestion/validation-messages.test.ts`

**Interfaces:**
- Consumes: `validateRulesetConfig`, `defaultRulesetConfig` de `src/rules-engine` (Plano 1, só no teste de `validation-messages`).
- Produces: `interface ExtractionResult { lore: string; rulesetConfig: unknown; clarifyingQuestions: string[] }`; `async function extractCampaignDocument(client: Anthropic, documentText: string): Promise<ExtractionResult>`; `function buildExtractionInput(documentText: string, clarificationNotes: string): string`; `function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[]`.

- [ ] **Step 1: Escrever testes falhos**

`tests/ingestion/extract.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extractCampaignDocument, buildExtractionInput } from '../../src/ingestion/extract';

function makeFakeClient(response: unknown): Anthropic {
  const create = vi.fn().mockResolvedValue(response);
  return { messages: { create } } as unknown as Anthropic;
}

describe('extractCampaignDocument', () => {
  it('devolve a extração estruturada a partir do tool_use forçado', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: { name: 'X' }, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractCampaignDocument(client, 'documento de exemplo');
    expect(result).toEqual({ lore: 'Uma torre antiga.', rulesetConfig: { name: 'X' }, clarifyingQuestions: [] });
  });

  it('força a chamada da ferramenta submeter_extracao', async () => {
    const client = makeFakeClient({
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'submeter_extracao', input: { lore: '', rulesetConfig: {}, clarifyingQuestions: [] } },
      ],
    });
    await extractCampaignDocument(client, 'documento de exemplo');
    const callArgs = (client.messages.create as any).mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'submeter_extracao' });
  });

  it('lança erro quando o modelo não devolve um tool_use', async () => {
    const client = makeFakeClient({ content: [{ type: 'text', text: 'desculpe, não consigo.' }] });
    await expect(extractCampaignDocument(client, 'documento de exemplo')).rejects.toThrow(/extração estruturada/);
  });
});

describe('buildExtractionInput', () => {
  it('devolve o documento original quando não há notas de esclarecimento', () => {
    expect(buildExtractionInput('doc original', '')).toBe('doc original');
  });

  it('anexa as notas de esclarecimento ao documento original', () => {
    const result = buildExtractionInput('doc original', 'O dado é d20.');
    expect(result).toContain('doc original');
    expect(result).toContain('O dado é d20.');
  });
});
```

`tests/ingestion/validation-messages.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatValidationIssues } from '../../src/ingestion/validation-messages';
import { validateRulesetConfig, defaultRulesetConfig } from '../../src/rules-engine';

describe('formatValidationIssues', () => {
  it('devolve lista vazia quando a validação passou', () => {
    const validation = validateRulesetConfig(defaultRulesetConfig());
    expect(formatValidationIssues(validation)).toEqual([]);
  });

  it('devolve uma mensagem para cada problema de validação', () => {
    const validation = validateRulesetConfig({ ...defaultRulesetConfig(), attackAttribute: 'nao-existe' });
    const issues = formatValidationIssues(validation);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toMatch(/configuração de regras incompleta/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/ingestion`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar**

`src/ingestion/extract.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';

export interface ExtractionResult {
  lore: string;
  rulesetConfig: unknown;
  clarifyingQuestions: string[];
}

const MODEL = 'claude-sonnet-5';

const EXTRACTION_SYSTEM_PROMPT = [
  'Você extrai informações de documentos de campanhas de RPG de mesa.',
  'Leia o documento e separe duas coisas: a lore/cenário (texto livre) e a configuração de regras (estruturada).',
  'A configuração de regras deve seguir este formato: name (string), attributes (lista de no máximo 5 nomes de atributos), testDie (4, 6, 8, 10, 12, 20 ou 100), resources (lista de { key, label, startingValue, linkedAttribute? }), hpResourceKey (deve corresponder a um resource.key), attackAttribute (deve estar em attributes), damageDie (mesmos valores de testDie), defenseValue (número).',
  'Preencha apenas os campos que puder inferir do documento com confiança. Para cada informação de regra que não puder inferir com confiança, adicione uma pergunta objetiva em clarifyingQuestions — nunca invente um valor.',
].join('\n');

const submeterExtracaoTool = {
  name: 'submeter_extracao',
  description: 'Envia a lore extraída e a configuração de regras extraída do documento da campanha.',
  input_schema: {
    type: 'object',
    properties: {
      lore: { type: 'string', description: 'Resumo da história/cenário extraído do documento, em texto livre.' },
      rulesetConfig: {
        type: 'object',
        description:
          'Configuração de regras extraída do documento, no formato esperado pelo motor de regras. Preencha apenas o que for possível inferir com confiança.',
      },
      clarifyingQuestions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Perguntas objetivas para o criador da campanha, uma por informação de regra que não pôde ser inferida com confiança. Vazio se a extração de regras estiver completa.',
      },
    },
    required: ['lore', 'rulesetConfig', 'clarifyingQuestions'],
  },
};

export async function extractCampaignDocument(client: Anthropic, documentText: string): Promise<ExtractionResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: documentText }],
    tools: [submeterExtracaoTool],
    tool_choice: { type: 'tool', name: 'submeter_extracao' },
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submeter_extracao'
  );
  if (!block) {
    throw new Error('O modelo não devolveu uma extração estruturada.');
  }
  return block.input as ExtractionResult;
}

export function buildExtractionInput(documentText: string, clarificationNotes: string): string {
  if (!clarificationNotes) return documentText;
  return `${documentText}\n\nInformações adicionais fornecidas pelo criador da campanha:\n${clarificationNotes}`;
}
```

`src/ingestion/validation-messages.ts`:
```ts
import type { validateRulesetConfig } from '../rules-engine';

export function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[] {
  if (validation.success) return [];
  return validation.error.issues.map((issue) => `Configuração de regras incompleta: ${issue.message}`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/ingestion`
Expected: PASS (5 + 2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/extract.ts src/ingestion/validation-messages.ts tests/ingestion
git commit -m "feat: add claude-based campaign document extraction"
```

---

### Task 4: `/criar-campanha` com documento opcional

**Files:**
- Modify: `src/bot/commands/criar-campanha.ts` (Plano 2, Task 5)
- Modify: `tests/bot/commands/criar-campanha.test.ts` (Plano 2, Task 5)

**Interfaces:**
- Consumes: `fetchAttachmentText` de `src/bot/attachments.ts` (Task 2); `extractCampaignDocument` de `src/ingestion/extract.ts` (Task 3, importado como namespace `ingestion` para testabilidade); `formatValidationIssues` de `src/ingestion/validation-messages.ts` (Task 3); `validateRulesetConfig`, `defaultRulesetConfig` de `src/rules-engine`.
- Produces: `execute(interaction: ChatInputCommandInteraction, pool: Pool, claudeClient: Anthropic): Promise<void>` — assinatura ganha o terceiro parâmetro `claudeClient`.

- [ ] **Step 1: Escrever testes falhos**

Substituir `tests/bot/commands/criar-campanha.test.ts` inteiro por:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../../src/db/test-db';
import { execute } from '../../../src/bot/commands/criar-campanha';
import { getCampaignByChannel } from '../../../src/db/campaigns-repo';
import * as ingestion from '../../../src/ingestion/extract';

function makeInteraction(
  overrides: { guildId?: string | null; channelId?: string; nome?: string; attachmentUrl?: string } = {}
) {
  const guildId = 'guildId' in overrides ? overrides.guildId : 'guild-1';
  const channelId = overrides.channelId ?? 'channel-1';
  const nome = overrides.nome ?? 'A Torre Esquecida';
  const attachmentUrl = overrides.attachmentUrl;
  const replies: unknown[] = [];
  let editedReply: unknown;
  return {
    guildId,
    channelId,
    options: {
      getString: () => nome,
      getAttachment: () => (attachmentUrl ? { url: attachmentUrl } : null),
    },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    deferReply: async () => {},
    editReply: async (payload: unknown) => {
      editedReply = payload;
    },
    get _lastReply() {
      return editedReply ?? replies[replies.length - 1];
    },
    _replies: replies,
  } as any;
}

describe('/criar-campanha execute', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(() => {
    vi.restoreAllMocks();
    pool = createTestPool();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => 'Documento de exemplo com lore e regras.' })
    );
  });

  it('cria uma campanha ativa com o ruleset padrão quando não há documento', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
  });

  it('recusa criar uma segunda campanha no mesmo canal', async () => {
    await execute(makeInteraction(), pool, claudeClient);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool, claudeClient);
    const reply = interaction2._replies[0] as { content: string };
    expect(reply.content).toMatch(/já existe/i);
  });

  it('recusa quando usado fora de um servidor', async () => {
    const interaction = makeInteraction({ guildId: null });
    await execute(interaction, pool, claudeClient);
    const reply = interaction._replies[0] as { content: string };
    expect(reply.content).toMatch(/servidor/i);
  });

  it('ativa a campanha direto quando o documento gera uma extração completa e válida', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: {
        name: 'Sistema Caseiro',
        attributes: ['vigor', 'agilidade'],
        testDie: 20,
        resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
        hpResourceKey: 'hp',
        attackAttribute: 'vigor',
        damageDie: 6,
        defenseValue: 11,
      },
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(campaign?.lore).toBe('Uma torre antiga.');
  });

  it('entra em rascunho e pergunta ao usuário quando a extração fica incompleta', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: { name: 'Sistema Caseiro' },
      clarifyingQuestions: ['Qual dado é usado nos testes?'],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(interaction._lastReply).toMatch(/qual dado é usado nos testes/i);
    expect(interaction._lastReply).toMatch(/responder-campanha/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: FAIL — `execute` ainda não aceita `claudeClient` nem lida com anexos.

- [ ] **Step 3: Implementar**

Substituir `src/bot/commands/criar-campanha.ts` inteiro por:
```ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig, validateRulesetConfig } from '../../rules-engine';
import { fetchAttachmentText } from '../attachments';
import * as ingestion from '../../ingestion/extract';
import { formatValidationIssues } from '../../ingestion/validation-messages';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true))
  .addAttachmentOption((opt) =>
    opt.setName('documento').setDescription('Documento opcional com lore e/ou regras da campanha').setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic
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

  if (!attachment) {
    const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig() });
    await interaction.reply(`Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.`);
    return;
  }

  await interaction.deferReply();
  const documentText = await fetchAttachmentText(attachment.url);
  const extraction = await ingestion.extractCampaignDocument(claudeClient, documentText);
  const validation = validateRulesetConfig(extraction.rulesetConfig);

  if (extraction.clarifyingQuestions.length === 0 && validation.success) {
    const campaign = await createCampaign(pool, {
      guildId,
      channelId,
      name: nome,
      rulesetConfig: validation.data,
      lore: extraction.lore,
      sourceDocument: documentText,
    });
    await interaction.editReply(
      `Campanha "${campaign.name}" criada a partir do documento! Sistema de regras: ${campaign.rulesetConfig.name}.`
    );
    return;
  }

  const campaign = await createCampaign(pool, {
    guildId,
    channelId,
    name: nome,
    rulesetConfig: defaultRulesetConfig(),
    lore: extraction.lore,
    sourceDocument: documentText,
    status: 'draft',
  });
  const questions = [...extraction.clarifyingQuestions, ...formatValidationIssues(validation)];
  await interaction.editReply(
    `Recebi o documento, mas preciso confirmar algumas coisas antes de liberar "${campaign.name}" para jogar:\n` +
      questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
      '\n\nResponda com `/responder-campanha resposta:<sua resposta>`.'
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/criar-campanha.ts tests/bot/commands/criar-campanha.test.ts
git commit -m "feat: support optional campaign document in /criar-campanha"
```

---

### Task 5: Comando `/responder-campanha` e wiring final

**Files:**
- Create: `src/bot/commands/responder-campanha.ts`
- Test: `tests/bot/commands/responder-campanha.test.ts`
- Modify: `src/bot/interaction-router.ts` (Plano 4, Task 6)
- Modify: `tests/bot/interaction-router.test.ts` (Plano 4, Task 6)
- Modify: `src/index.ts` (Plano 3, Task 7)
- Modify: `scripts/register-commands.ts` (Plano 2, Task 8)

**Interfaces:**
- Consumes: `getCampaignByChannel`, `saveDraftProgress`, `activateCampaign` de `src/db/campaigns-repo.ts` (Task 1); `extractCampaignDocument`, `buildExtractionInput` de `src/ingestion/extract.ts` (Task 3); `validateRulesetConfig`, `defaultRulesetConfig` de `src/rules-engine`; `formatValidationIssues` de `src/ingestion/validation-messages.ts` (Task 3).
- Produces: `export const data: SlashCommandBuilder` (nome `responder-campanha`, opção string `resposta` obrigatória); `async function execute(interaction: ChatInputCommandInteraction, pool: Pool, claudeClient: Anthropic): Promise<void>`. `routeInteraction` passa a receber `claudeClient: Anthropic` como terceiro parâmetro.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/commands/responder-campanha.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/responder-campanha';
import * as ingestion from '../../../src/ingestion/extract';

function makeInteraction(resposta: string) {
  const replies: unknown[] = [];
  let editedReply: unknown;
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    options: { getString: () => resposta },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    deferReply: async () => {},
    editReply: async (payload: unknown) => {
      editedReply = payload;
    },
    get _lastReply() {
      return editedReply ?? replies[replies.length - 1];
    },
  } as any;
}

describe('/responder-campanha execute', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      lore: 'Uma torre antiga.',
      sourceDocument: 'documento original',
      status: 'draft',
    });
  });

  it('recusa quando não há campanha em rascunho no canal', async () => {
    const otherPool = createTestPool();
    const interaction = makeInteraction('o dado é d20');
    await execute(interaction, otherPool, claudeClient);
    expect(interaction._lastReply.content).toMatch(/não há campanha em rascunho/i);
  });

  it('ativa a campanha quando a nova extração fica completa e válida', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: {
        name: 'Sistema Caseiro',
        attributes: ['vigor'],
        testDie: 20,
        resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
        hpResourceKey: 'hp',
        attackAttribute: 'vigor',
        damageDie: 6,
        defenseValue: 11,
      },
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction('o dado de teste é d20');
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(interaction._lastReply).toMatch(/pronta para jogar/i);
  });

  it('permanece em rascunho e acumula as notas quando ainda faltam informações', async () => {
    vi.spyOn(ingestion, 'extractCampaignDocument').mockResolvedValue({
      lore: 'Uma torre antiga.',
      rulesetConfig: { name: 'Sistema Caseiro' },
      clarifyingQuestions: ['Qual é o dado de dano?'],
    });
    const interaction = makeInteraction('o dado de teste é d20');
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.clarificationNotes).toBe('o dado de teste é d20');
    expect(interaction._lastReply).toMatch(/qual é o dado de dano/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/responder-campanha.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

`src/bot/commands/responder-campanha.ts`:
```ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { activateCampaign, getCampaignByChannel, saveDraftProgress } from '../../db/campaigns-repo';
import { defaultRulesetConfig, validateRulesetConfig } from '../../rules-engine';
import * as ingestion from '../../ingestion/extract';
import { formatValidationIssues } from '../../ingestion/validation-messages';

export const data = new SlashCommandBuilder()
  .setName('responder-campanha')
  .setDescription('Responde às perguntas pendentes sobre o documento da campanha em rascunho')
  .addStringOption((opt) =>
    opt.setName('resposta').setDescription('Sua resposta às perguntas pendentes').setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'draft') {
    await interaction.reply({ content: 'Não há campanha em rascunho aguardando respostas neste canal.', ephemeral: true });
    return;
  }
  const resposta = interaction.options.getString('resposta', true);
  const updatedNotes = campaign.clarificationNotes ? `${campaign.clarificationNotes}\n${resposta}` : resposta;

  await interaction.deferReply();
  const combinedInput = ingestion.buildExtractionInput(campaign.sourceDocument, updatedNotes);
  const extraction = await ingestion.extractCampaignDocument(claudeClient, combinedInput);
  const validation = validateRulesetConfig(extraction.rulesetConfig);

  if (extraction.clarifyingQuestions.length === 0 && validation.success) {
    const activated = await activateCampaign(pool, campaign.id, { lore: extraction.lore, rulesetConfig: validation.data });
    await interaction.editReply(
      `Obrigado! Campanha "${activated.name}" está pronta para jogar. Sistema de regras: ${activated.rulesetConfig.name}.`
    );
    return;
  }

  await saveDraftProgress(pool, campaign.id, {
    lore: extraction.lore,
    rulesetConfig: defaultRulesetConfig(),
    clarificationNotes: updatedNotes,
  });
  const questions = [...extraction.clarifyingQuestions, ...formatValidationIssues(validation)];
  await interaction.editReply(
    'Ainda faltam algumas coisas antes de liberar a campanha:\n' +
      questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
      '\n\nResponda novamente com `/responder-campanha resposta:<sua resposta>`.'
  );
}
```

Substituir `src/bot/interaction-router.ts` inteiro por:
```ts
import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';
import * as iniciarCombate from './commands/iniciar-combate';
import * as responderCampanha from './commands/responder-campanha';

export async function routeInteraction(interaction: Interaction, pool: Pool, claudeClient: Anthropic): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool, claudeClient);
      return;
    }
    if (interaction.commandName === 'criar-personagem') {
      await criarPersonagem.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'iniciar-combate') {
      await iniciarCombate.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'responder-campanha') {
      await responderCampanha.execute(interaction, pool, claudeClient);
      return;
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('criar-personagem:')) {
      await criarPersonagem.handleModalSubmit(interaction, pool);
      return;
    }
    if (interaction.customId.startsWith('iniciar-combate:')) {
      await iniciarCombate.handleModalSubmit(interaction, pool);
      return;
    }
  }
}
```

Substituir `tests/bot/interaction-router.test.ts` inteiro por:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { routeInteraction } from '../../src/bot/interaction-router';
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';
import * as iniciarCombate from '../../src/bot/commands/iniciar-combate';
import * as responderCampanha from '../../src/bot/commands/responder-campanha';

describe('routeInteraction', () => {
  const pool = {} as Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('despacha /criar-campanha para criarCampanha.execute', async () => {
    const spy = vi.spyOn(criarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient);
  });

  it('despacha /criar-personagem para criarPersonagem.execute', async () => {
    const spy = vi.spyOn(criarPersonagem, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-personagem' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal criar-personagem:* para criarPersonagem.handleModalSubmit', async () => {
    const spy = vi.spyOn(criarPersonagem, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'criar-personagem:abc123:Aria' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /iniciar-combate para iniciarCombate.execute', async () => {
    const spy = vi.spyOn(iniciarCombate, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'iniciar-combate' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal iniciar-combate:* para iniciarCombate.handleModalSubmit', async () => {
    const spy = vi.spyOn(iniciarCombate, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'iniciar-combate:abc123:Goblin' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /responder-campanha para responderCampanha.execute', async () => {
    const spy = vi.spyOn(responderCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'responder-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient);
  });

  it('ignora comandos desconhecidos sem lançar erro', async () => {
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'comando-desconhecido' } as any;
    await expect(routeInteraction(interaction, pool, claudeClient)).resolves.toBeUndefined();
  });
});
```

Em `src/index.ts`, alterar a chamada dentro do listener `interactionCreate` de `routeInteraction(interaction, pool)` para `routeInteraction(interaction, pool, claudeClient)`.

Em `scripts/register-commands.ts`, adicionar o import `import { data as responderCampanhaData } from '../src/bot/commands/responder-campanha';` e incluir `responderCampanhaData.toJSON()` no array `body`.

- [ ] **Step 4: Rodar a suíte inteira e o type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em todos os testes (Planos 1-5), sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/responder-campanha.ts tests/bot/commands/responder-campanha.test.ts src/bot/interaction-router.ts tests/bot/interaction-router.test.ts src/index.ts scripts/register-commands.ts
git commit -m "feat: add /responder-campanha and wire claude client through the interaction router"
```

---

### Task 6: Smoke test manual completo de ingestão

**Files:**
- Nenhum arquivo novo — apenas verificação manual.

- [ ] **Step 1: Preparar um documento de teste**

Criar um arquivo de texto simples (`.txt`) com um cenário curto e uma seção de regras deliberadamente incompleta (ex: menciona atributos e pontos de vida, mas não diz qual dado usar em testes).

- [ ] **Step 2: Rodar `npm run register-commands` para publicar `/responder-campanha`**

Run: `npm run register-commands`
Expected: comando aparece no servidor de teste.

- [ ] **Step 3: Testar o caminho de rascunho**

1. Rodar `/criar-campanha nome:Teste Documento documento:<anexar o .txt>` em um canal novo.
2. Confirmar que o bot responde listando perguntas de esclarecimento e mencionando `/responder-campanha`.
3. Rodar `/responder-campanha resposta:O dado de teste é d20 e o de dano é d6.`
4. Confirmar que a campanha é ativada (ou que uma nova pergunta aparece, se a resposta ainda deixar algo em aberto — repetir até ativar).
5. Rodar `/criar-personagem` e confirmar que os atributos do modal correspondem aos atributos extraídos do documento, não ao ruleset padrão.

- [ ] **Step 4: Testar o caminho direto (documento completo)**

1. Escrever um segundo documento de teste que já descreva claramente atributos, dado de teste, recursos e dificuldade de defesa.
2. Rodar `/criar-campanha nome:Teste Direto documento:<anexar este documento>` em outro canal.
3. Confirmar que a campanha é criada como ativa imediatamente, sem perguntas de esclarecimento.

- [ ] **Step 5: Testar o caminho sem documento (regressão)**

1. Rodar `/criar-campanha nome:Teste Sem Documento` (sem anexo) em um terceiro canal.
2. Confirmar que a campanha é criada imediatamente com o Sistema Simplificado Padrão, como nos Planos 2-4.

---

## Self-Review

**Cobertura da spec:** cobre a última peça do MVP — upload de documento na criação da campanha, extração única (nunca em tempo real durante o jogo) de lore + `ruleset_config`, validação com o mesmo schema usado em todo o resto do sistema, e o fluxo de esclarecimento via `/responder-campanha` quando a extração fica incompleta. Com este plano, todas as seções do design (`docs/superpowers/specs/2026-07-05-mestre-rpg-ia-design.md`) estão implementadas.

**Placeholders:** nenhum — todo código é completo; a Task 6 é deliberadamente manual (requer documentos reais e uma chave de API real da Anthropic), mas cada verificação é concreta.

**Consistência de tipos:** `ExtractionResult`, `saveDraftProgress`, `activateCampaign` são definidos uma vez (Tasks 1 e 3) e usados com os mesmos nomes em `criar-campanha.ts`, `responder-campanha.ts` e nos testes. `routeInteraction` ganha `claudeClient` de forma consistente em `index.ts`, no roteador e em todos os testes que o chamam.
