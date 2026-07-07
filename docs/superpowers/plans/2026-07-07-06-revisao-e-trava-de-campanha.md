# Revisão e trava de configuração de campanha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "ask questions until the ruleset is complete" loop with an assume-review-lock flow (`draft` → `active` → `paused` → `active`), add `/iniciar-campanha`, `/pausar-campanha`, `/retomar-campanha`, random lore for document-less campaigns, and a `/minha-ficha` command for players to check their own sheet.

**Architecture:** Extraction (`extractCampaignDocument` in `src/ingestion/extract.ts`) always returns a usable `rulesetConfig` now — inferred from the document, defaulted where not inferrable, or replaced wholesale by `defaultRulesetConfig()` if the model's output still fails validation. `draft` status is repurposed from "incomplete, blocked" to "complete, open for free-text review/editing"; only the new `/iniciar-campanha` command flips a campaign to `active` and none of the editing code paths do so anymore. Three new slash commands manage the `draft → active → paused → active` lifecycle; a fourth (`/minha-ficha`) is unrelated to that lifecycle and just reads a player's own character sheet.

**Tech Stack:** TypeScript (strict), discord.js v14, `@anthropic-ai/sdk`, Postgres (`pg`), Zod, Vitest. Same toolchain as Plans 1-5, no new dependencies.

## Global Constraints

- All user-facing strings are in Portuguese (existing project convention — every message in this plan is written out verbatim, copy it as-is).
- `campaigns.status` is `TEXT` with no `CHECK` constraint (`src/db/migrations/001_init.sql:6`) — adding the `'paused'` value requires no SQL migration, only TypeScript type/logic changes.
- Once a campaign reaches `active` for the first time, its `rulesetConfig` is never editable again through any code path — pausing/resuming must not reopen it.
- `/criar-personagem` already requires `campaign.status === 'active'` (`src/bot/commands/criar-personagem.ts:41`) — do not change that check in this plan.
- Follow the existing test-mocking convention for the extraction pipeline: `vi.spyOn(ingestion, 'extractCampaignDocument')` where `ingestion` is `import * as ingestion from '.../ingestion/extract'` (see `tests/bot/commands/criar-campanha.test.ts` for the working pattern) — a plain named import does **not** get intercepted correctly by `vi.spyOn` in this codebase's Vite/esbuild setup.
- Run `npx tsc --noEmit` and `npx vitest run` after every task; both must be clean before committing.

---

### Task 1: `paused` campaign status + repo functions

**Files:**
- Modify: `src/db/campaigns-repo.ts`
- Test: `tests/db/campaigns-repo.test.ts`

**Interfaces:**
- Produces: `CampaignStatus = 'draft' | 'active' | 'paused'`; `activateCampaign(pool: Pool, campaignId: string): Promise<Campaign>` (signature changed — no longer takes a `params` object); `pauseCampaign(pool: Pool, campaignId: string): Promise<Campaign>` (new).

- [ ] **Step 1: Write the failing tests**

Replace the existing `'ativa uma campanha em rascunho'` test in `tests/db/campaigns-repo.test.ts` (it currently calls `activateCampaign(pool, campaign.id, { lore, rulesetConfig })`, which won't compile against the new signature) and add a `pauseCampaign` test, right after it:

```typescript
  it('ativa uma campanha em rascunho', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const activated = await activateCampaign(pool, campaign.id);
    expect(activated.status).toBe('active');
    expect(activated.lore).toBe(campaign.lore);
    expect(activated.rulesetConfig).toEqual(campaign.rulesetConfig);
  });

  it('pausa uma campanha ativa', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    const paused = await pauseCampaign(pool, campaign.id);
    expect(paused.status).toBe('paused');
  });

  it('retoma uma campanha pausada chamando activateCampaign de novo', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    await pauseCampaign(pool, campaign.id);
    const resumed = await activateCampaign(pool, campaign.id);
    expect(resumed.status).toBe('active');
  });
});
```

Update the import line at the top of the file to include `pauseCampaign`:

```typescript
import { createCampaign, getCampaignByChannel, updateSessionSummary, saveDraftProgress, activateCampaign, pauseCampaign } from '../../src/db/campaigns-repo';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: FAIL — `pauseCampaign` is not exported, and `activateCampaign`'s old signature doesn't match the new call (TypeScript compile error surfaces as a test failure since vitest transpiles on the fly).

- [ ] **Step 3: Implement**

In `src/db/campaigns-repo.ts`, change line 5 from:

```typescript
export type CampaignStatus = 'draft' | 'active';
```

to:

```typescript
export type CampaignStatus = 'draft' | 'active' | 'paused';
```

Replace the `activateCampaign` function (lines 94-104) with:

```typescript
export async function activateCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}

export async function pauseCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'paused' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: PASS (all tests in the file)

Also run: `npx tsc --noEmit`
Expected: no errors (this will surface any other file still calling `activateCampaign` with the old 3-argument signature — there should be exactly one, `src/ingestion/draft-flow.ts`, which Task 3 fixes; if `tsc` reports it, that's expected at this point and gets resolved in Task 3, not this task — don't fix it here).

- [ ] **Step 5: Commit**

```bash
git add src/db/campaigns-repo.ts tests/db/campaigns-repo.test.ts
git commit -m "feat(db): add paused campaign status and pauseCampaign, simplify activateCampaign"
```

---

### Task 2: Always-complete extraction + validation safety net

**Files:**
- Modify: `src/ingestion/extract.ts`
- Test: `tests/ingestion/extract.test.ts`

**Interfaces:**
- Consumes: `defaultRulesetConfig`, `validateRulesetConfig` from `../rules-engine`.
- Produces: `extractResolvedConfig(client: Anthropic, documentText: string): Promise<{ lore: string; rulesetConfig: ValidatedRulesetConfig; clarifyingQuestions: string[] }>` — the extraction result guaranteed to always carry a valid `rulesetConfig` (never a raw/unvalidated one).

- [ ] **Step 1: Write the failing tests**

Add to `tests/ingestion/extract.test.ts` (keep the existing `describe('extractCampaignDocument', ...)` and `describe('buildExtractionInput', ...)` blocks untouched, add a new block after them):

```typescript
describe('extractResolvedConfig', () => {
  const validConfig = {
    name: 'Sistema Caseiro',
    attributes: ['vigor'],
    testDie: 20,
    resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
    hpResourceKey: 'hp',
    attackAttribute: 'vigor',
    damageDie: 6,
    defenseValue: 11,
  };

  it('devolve a rulesetConfig extraída quando ela é válida', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: validConfig, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.lore).toBe('Uma torre antiga.');
    expect(result.rulesetConfig).toEqual(validConfig);
    expect(result.clarifyingQuestions).toEqual([]);
  });

  it('cai no sistema padrão quando a rulesetConfig extraída falha na validação', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: { name: 'Incompleto' }, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.rulesetConfig).toEqual(defaultRulesetConfig());
    expect(result.lore).toBe('Uma torre antiga.');
  });

  it('preserva as clarifyingQuestions mesmo quando cai no sistema padrão', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: {
            lore: '',
            rulesetConfig: { name: 'Incompleto' },
            clarifyingQuestions: ['A coluna X representa ataque ou defesa? Sugiro ataque.'],
          },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.clarifyingQuestions).toEqual(['A coluna X representa ataque ou defesa? Sugiro ataque.']);
  });
});
```

Add the new imports at the top of the test file — change:

```typescript
import { extractCampaignDocument, buildExtractionInput } from '../../src/ingestion/extract';
```

to:

```typescript
import { extractCampaignDocument, buildExtractionInput, extractResolvedConfig } from '../../src/ingestion/extract';
import { defaultRulesetConfig } from '../../src/rules-engine';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ingestion/extract.test.ts`
Expected: FAIL — `extractResolvedConfig` is not exported.

- [ ] **Step 3: Implement**

In `src/ingestion/extract.ts`, replace the import line and add a new one — change line 3 from:

```typescript
import { defaultRulesetConfig } from '../rules-engine';
```

to:

```typescript
import { defaultRulesetConfig, validateRulesetConfig, type ValidatedRulesetConfig } from '../rules-engine';
```

Replace the `EXTRACTION_SYSTEM_PROMPT` array (lines 15-24) with:

```typescript
const EXTRACTION_SYSTEM_PROMPT = [
  'Você extrai informações de documentos de campanhas de RPG de mesa.',
  'Leia o documento e separe duas coisas: a lore/cenário (texto livre) e a configuração de regras (estruturada).',
  'A configuração de regras deve seguir este formato: name (string), attributes (lista de no máximo 5 nomes de atributos), testDie (4, 6, 8, 10, 12, 20 ou 100), resources (lista de { key, label, startingValue, linkedAttribute? }), hpResourceKey (deve corresponder a um resource.key), attackAttribute (deve estar em attributes), damageDie (mesmos valores de testDie), defenseValue (número).',
  'Sempre devolva uma rulesetConfig completa, com todos os campos preenchidos — nunca deixe um campo estrutural de fora. Para cada campo, tente inferir do documento com o máximo de confiança possível; para o que não puder inferir, use o valor correspondente deste sistema de regras padrão como base: ' +
    DEFAULT_RULESET_JSON +
    '.',
  'Use clarifyingQuestions somente para ambiguidades de interpretação do conteúdo do documento — nunca para sinalizar um campo que você preencheu com um valor padrão (isso é esperado e não precisa ser perguntado). Exemplo de ambiguidade real: um valor do documento pode ser mapeado de mais de uma forma para o sistema de regras (ex: uma coluna de bônus que pode representar ataque ou dificuldade), ou um termo do documento (ex: "teste de sanidade") sugere um atributo/recurso que ainda não está definido.',
  'Toda pergunta em clarifyingQuestions deve terminar propondo sua melhor sugestão (com base no que o documento já indica, ou uma convenção razoável de RPG) — nunca deixe uma pergunta totalmente em aberto sem alguma sugestão concreta para o criador aceitar ou corrigir.',
].join('\n');
```

(Note: this removes the old "usar padrão" on-request instruction — it's no longer needed as a separate opt-in phrase, since defaulting is now always-on. `DEFAULT_RULESET_JSON` stays defined exactly as before, just above this block.)

Also update the tool's `rulesetConfig` property description (inside `submeterExtracaoTool.input_schema.properties`) — change:

```typescript
      rulesetConfig: {
        type: 'object',
        description:
          'Configuração de regras extraída do documento, no formato esperado pelo motor de regras. Preencha apenas o que for possível inferir com confiança.',
      },
```

to:

```typescript
      rulesetConfig: {
        type: 'object',
        description:
          'Configuração de regras completa, no formato esperado pelo motor de regras. Todo campo deve estar preenchido — inferido do documento ou copiado do sistema padrão fornecido no prompt.',
      },
```

Finally, add `extractResolvedConfig` at the end of the file (after `buildExtractionInput`):

```typescript
export async function extractResolvedConfig(
  client: Anthropic,
  documentText: string
): Promise<{ lore: string; rulesetConfig: ValidatedRulesetConfig; clarifyingQuestions: string[] }> {
  const extraction = await extractCampaignDocument(client, documentText);
  const validation = validateRulesetConfig(extraction.rulesetConfig);
  return {
    lore: extraction.lore,
    rulesetConfig: validation.success ? validation.data : defaultRulesetConfig(),
    clarifyingQuestions: extraction.clarifyingQuestions,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ingestion/extract.test.ts`
Expected: PASS (all tests, including the 3 pre-existing ones for `extractCampaignDocument`/`buildExtractionInput`)

Also run: `npx tsc --noEmit`
Expected: no new errors introduced by this task (the pre-existing `draft-flow.ts` compile error from Task 1 is still expected here — Task 3 fixes it).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/extract.ts tests/ingestion/extract.test.ts
git commit -m "feat(ingestion): extraction always returns a valid rulesetConfig"
```

---

### Task 3: Rewrite `draft-flow.ts` — review summary, no auto-activation, remove dead validation-messages code

**Files:**
- Modify: `src/ingestion/draft-flow.ts`
- Delete: `src/ingestion/validation-messages.ts`
- Delete: `tests/ingestion/validation-messages.test.ts`
- Modify: `src/rules-engine/index.ts` (stop publicly exporting `DIE_SIZES`, it was only needed by the deleted file)
- Test: `tests/ingestion/draft-flow.test.ts` (new file)

**Interfaces:**
- Consumes: `extractResolvedConfig`, `buildExtractionInput` from `./extract` (Task 2); `saveDraftProgress`, `type Campaign` from `../db/campaigns-repo` (Task 1, unchanged signature).
- Produces: `formatDraftSummary(campaign: Campaign, clarifyingQuestions: string[]): string`; `processDraftAnswer(pool: Pool, claudeClient: Anthropic, campaign: Campaign, answer: string): Promise<DraftAnswerResult>` where `DraftAnswerResult = { message: string }` (dropped the `activated` field — nothing in this file activates campaigns anymore). Both are consumed by Task 4 (`criar-campanha.ts`), the command tasks' `message-handler.ts` update, and `responder-campanha.ts` (already imports `processDraftAnswer`, needs no change since it only used `result.message`).

- [ ] **Step 1: Write the failing tests**

Create `tests/ingestion/draft-flow.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel, type Campaign } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { processDraftAnswer, formatDraftSummary } from '../../src/ingestion/draft-flow';
import * as ingestion from '../../src/ingestion/extract';

describe('processDraftAnswer', () => {
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
      lore: 'Lore original',
      sourceDocument: 'documento original',
      status: 'draft',
    });
  });

  async function getDraft(): Promise<Campaign> {
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    if (!campaign) throw new Error('campanha não encontrada no teste');
    return campaign;
  }

  it('nunca ativa a campanha, mesmo quando a extração fica completa e sem clarifyingQuestions', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    const updated = await getDraft();
    expect(updated.status).toBe('draft');
    expect(updated.lore).toBe('Lore atualizada');
  });

  it('acumula a resposta nas notas de esclarecimento', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    const updated = await getDraft();
    expect(updated.clarificationNotes).toBe('o dado de teste é d20');
  });

  it('a mensagem de retorno inclui o resumo da configuração e a chamada para /iniciar-campanha', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: [],
    });
    const campaign = await getDraft();
    const result = await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    expect(result.message).toMatch(/dado de teste: d20/i);
    expect(result.message).toMatch(/\/iniciar-campanha/);
  });

  it('a mensagem de retorno inclui as clarifyingQuestions quando existirem', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
      lore: 'Lore atualizada',
      rulesetConfig: defaultRulesetConfig(),
      clarifyingQuestions: ['A coluna X representa ataque ou defesa? Sugiro ataque.'],
    });
    const campaign = await getDraft();
    const result = await processDraftAnswer(pool, claudeClient, campaign, 'o dado de teste é d20');
    expect(result.message).toMatch(/coluna X representa ataque ou defesa/i);
  });
});

describe('formatDraftSummary', () => {
  it('lista todos os campos da rulesetConfig', () => {
    const campaign = {
      id: 'c1',
      guildId: 'g1',
      channelId: 'ch1',
      name: 'Minha Campanha',
      status: 'draft' as const,
      rulesetConfig: defaultRulesetConfig(),
      lore: 'Uma lore.',
      sessionSummary: '',
      sourceDocument: '',
      clarificationNotes: '',
    };
    const summary = formatDraftSummary(campaign, []);
    expect(summary).toMatch(/Minha Campanha/);
    expect(summary).toMatch(/Uma lore\./);
    expect(summary).toMatch(/Sistema Simplificado Padrão/);
    expect(summary).toMatch(/forca, destreza, intelecto/);
    expect(summary).toMatch(/d20/);
    expect(summary).toMatch(/\/iniciar-campanha/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ingestion/draft-flow.test.ts`
Expected: FAIL — `formatDraftSummary` is not exported, `extractResolvedConfig` is not spied on correctly (current `draft-flow.ts` still calls `extractCampaignDocument`), `processDraftAnswer` still returns `activated`.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/ingestion/draft-flow.ts`:

```typescript
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { saveDraftProgress, type Campaign } from '../db/campaigns-repo';
import type { ValidatedRulesetConfig } from '../rules-engine';
import * as ingestion from './extract';

export interface DraftAnswerResult {
  message: string;
}

function formatRulesetSummary(config: ValidatedRulesetConfig): string {
  const resourceLines = config.resources
    .map(
      (r) =>
        `${r.label} ("${r.key}", inicial ${r.startingValue}${r.linkedAttribute ? `, ligado a ${r.linkedAttribute}` : ''})`
    )
    .join('; ');
  return [
    `- Nome do sistema: ${config.name}`,
    `- Atributos: ${config.attributes.join(', ')}`,
    `- Dado de teste: d${config.testDie}`,
    `- Recursos: ${resourceLines}`,
    `- Recurso de HP: ${config.hpResourceKey}`,
    `- Atributo de ataque: ${config.attackAttribute}`,
    `- Dado de dano: d${config.damageDie}`,
    `- Valor de defesa: ${config.defenseValue}`,
  ].join('\n');
}

export function formatDraftSummary(campaign: Campaign, clarifyingQuestions: string[]): string {
  const parts = [`Configuração assumida para "${campaign.name}":`, formatRulesetSummary(campaign.rulesetConfig)];
  if (campaign.lore) {
    parts.push(`Lore: ${campaign.lore}`);
  }
  if (clarifyingQuestions.length > 0) {
    parts.push('Ainda tenho dúvidas sobre:\n' + clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'));
  }
  parts.push(
    'Pode responder aqui mesmo no canal com qualquer ajuste, ou rodar `/iniciar-campanha` para aceitar como está e começar.'
  );
  return parts.join('\n\n');
}

export async function processDraftAnswer(
  pool: Pool,
  claudeClient: Anthropic,
  campaign: Campaign,
  answer: string
): Promise<DraftAnswerResult> {
  const updatedNotes = campaign.clarificationNotes ? `${campaign.clarificationNotes}\n${answer}` : answer;
  const combinedInput = ingestion.buildExtractionInput(campaign.sourceDocument, updatedNotes);
  const resolved = await ingestion.extractResolvedConfig(claudeClient, combinedInput);

  const updated = await saveDraftProgress(pool, campaign.id, {
    lore: resolved.lore,
    rulesetConfig: resolved.rulesetConfig,
    clarificationNotes: updatedNotes,
  });

  return { message: formatDraftSummary(updated, resolved.clarifyingQuestions) };
}
```

Delete the two dead files:

```bash
rm src/ingestion/validation-messages.ts tests/ingestion/validation-messages.test.ts
```

In `src/rules-engine/index.ts`, remove `DIE_SIZES` from the public export (it's still used internally by `ruleset-config.ts`, just no longer needed outside `rules-engine`) — change:

```typescript
export { validateRulesetConfig, defaultRulesetConfig, RulesetConfigSchema, DIE_SIZES } from './ruleset-config';
```

to:

```typescript
export { validateRulesetConfig, defaultRulesetConfig, RulesetConfigSchema } from './ruleset-config';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ingestion/draft-flow.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: errors in `src/bot/commands/criar-campanha.ts` and `src/bot/commands/responder-campanha.ts` are expected at this point (criar-campanha.ts still imports the now-deleted `validation-messages.ts` and references the old `DraftAnswerResult.activated` shape indirectly through `criar-campanha.ts`'s own duplicated logic — Task 4 fixes `criar-campanha.ts`; `responder-campanha.ts` only reads `result.message`, so it should already compile cleanly — verify it does, don't proceed to Task 4 if `responder-campanha.ts` itself has an error, since that would mean this task introduced a real regression rather than the expected/known Task-4 gap).

Run the full suite to see the current known-broken state: `npx vitest run 2>&1 | tail -30` — `tests/bot/commands/criar-campanha.test.ts` and `tests/bot/message-handler.test.ts` will fail (they exercise the old two-branch/`activated` behavior). That's expected; Task 4 and the message-handler update fix them respectively. Confirm no *other* test file regresses.

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/draft-flow.ts src/rules-engine/index.ts tests/ingestion/draft-flow.test.ts
git rm src/ingestion/validation-messages.ts tests/ingestion/validation-messages.test.ts
git commit -m "feat(ingestion): draft-flow never auto-activates, always shows a full review summary"
```

(Leave `tests/bot/commands/criar-campanha.test.ts` and `tests/bot/message-handler.test.ts` broken for now — they get fixed in Task 4 and Task 6 respectively, each with its own commit.)

---

### Task 4: `/criar-campanha` with document always enters `draft` for review

**Files:**
- Modify: `src/bot/commands/criar-campanha.ts`
- Modify: `tests/bot/commands/criar-campanha.test.ts`

**Interfaces:**
- Consumes: `extractResolvedConfig` from `../../ingestion/extract` (Task 2), `formatDraftSummary` from `../../ingestion/draft-flow` (Task 3).

- [ ] **Step 1: Write the failing tests**

Replace the two tests `'ativa a campanha direto quando o documento gera uma extração completa e válida'` and `'entra em rascunho e pergunta ao usuário quando a extração fica incompleta'` in `tests/bot/commands/criar-campanha.test.ts` — both collapse into "always drafts", so replace both with:

```typescript
  it('sempre cria a campanha em rascunho quando há documento, mesmo com extração completa', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
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
      } as any,
      clarifyingQuestions: [],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Caseiro');
    expect(campaign?.lore).toBe('Uma torre antiga.');
    expect(interaction._lastReply).toMatch(/Sistema Caseiro/);
    expect(interaction._lastReply).toMatch(/\/iniciar-campanha/);
  });

  it('inclui as clarifyingQuestions no resumo quando existirem', async () => {
    vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
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
      } as any,
      clarifyingQuestions: ['Qual dado é usado nos testes? Sugiro d20.'],
    });
    const interaction = makeInteraction({ attachmentUrl: 'https://discord.example/doc.txt' });
    await execute(interaction, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('draft');
    expect(interaction._lastReply).toMatch(/qual dado é usado nos testes/i);
  });
```

The mock import at the top of the file, `import * as ingestion from '../../../src/ingestion/extract';`, stays as-is (it already imports the whole module — only the mocked function name changes at each call site, from `extractCampaignDocument` to `extractResolvedConfig`).

The other two document-path tests already in the file — `'responde com uma mensagem de erro amigável quando o processamento do documento falha'` and `'responde com mensagem específica e não cria campanha quando o formato do anexo não é suportado'` — mock `ingestion.extractCampaignDocument`/don't touch extraction at all respectively. Update the failure test to mock the new function name — change:

```typescript
    vi.spyOn(ingestion, 'extractCampaignDocument').mockRejectedValue(new Error('O modelo não devolveu uma extração estruturada.'));
```

to:

```typescript
    vi.spyOn(ingestion, 'extractResolvedConfig').mockRejectedValue(new Error('O modelo não devolveu uma extração estruturada.'));
```

Since the no-document branch now calls `generateRandomLore` (see Step 3 below for the stub this depends on), add an import and a default mock so the existing no-document tests in this file keep passing. Add this import at the top of the file, alongside the existing `import * as ingestion ...` line:

```typescript
import * as randomLore from '../../../src/ingestion/random-lore';
```

Add one line to the existing `beforeEach` — change:

```typescript
  beforeEach(() => {
    vi.restoreAllMocks();
    pool = createTestPool();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => 'Documento de exemplo com lore e regras.' })
    );
  });
```

to:

```typescript
  beforeEach(() => {
    vi.restoreAllMocks();
    pool = createTestPool();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => 'Documento de exemplo com lore e regras.' })
    );
    vi.spyOn(randomLore, 'generateRandomLore').mockResolvedValue('Uma lore de teste.');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: FAIL — `criar-campanha.ts` still imports the deleted `validation-messages.ts` (compile error) and still branches on completeness.

- [ ] **Step 3: Implement**

Replace the entire contents of `src/bot/commands/criar-campanha.ts`:

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig } from '../../rules-engine';
import { fetchAttachmentText, UnsupportedAttachmentError } from '../attachments';
import { extractResolvedConfig } from '../../ingestion/extract';
import { formatDraftSummary } from '../../ingestion/draft-flow';
import { generateRandomLore } from '../../ingestion/random-lore';

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
    const documentText = await fetchAttachmentText(attachment.url, attachment.name);
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
    await interaction.editReply(formatDraftSummary(campaign, resolved.clarifyingQuestions));
    return;
  } catch (err) {
    if (err instanceof UnsupportedAttachmentError) {
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

Note: this imports `generateRandomLore` from `../../ingestion/random-lore`, which doesn't exist yet — that's created in Task 9. **This task will not typecheck cleanly until Task 9 lands.** To keep this task's own test cycle green in the meantime, stub the module now with a minimal placeholder that Task 9 will replace wholesale:

Create `src/ingestion/random-lore.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';

export async function generateRandomLore(_client: Anthropic): Promise<string> {
  throw new Error('generateRandomLore ainda não implementado');
}
```

(Task 9 replaces this file's contents entirely with the real implementation and its own test file — this stub only exists so Tasks 4-8 compile and their own tests, which don't exercise the no-document branch, stay green.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: PASS (7 tests: the 2 new draft-summary tests, the pre-existing no-document/duplicate-campaign/no-guild/unsupported-format/failure tests — the `beforeEach` mock from Step 1 keeps the no-document tests passing against the throwing stub)

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/criar-campanha.ts src/ingestion/random-lore.ts tests/bot/commands/criar-campanha.test.ts
git commit -m "feat(bot): /criar-campanha always enters draft for review when a document is attached"
```

---

### Task 5: `message-handler.ts` — make `paused`-campaign handling explicit, add regression tests

**Note before starting:** because `CampaignStatus` already includes `'paused'` as of Task 1, and `draft-flow.ts` already never auto-activates as of Task 3, `message-handler.ts`'s existing `if (campaign.status !== 'active') return;` guard (line 42) *already* silently ignores `paused` campaigns as an incidental side effect — `'paused' !== 'active'` is true, so it falls through and returns. This task does not fix a bug; it makes that behavior an explicit, intentional branch instead of a coincidence of a catch-all check, and adds regression tests locking in both the `draft` and `paused` behaviors so a future change to the status model can't silently break either one without a test failing.

**Files:**
- Modify: `src/bot/message-handler.ts`
- Modify: `tests/bot/message-handler.test.ts`

**Interfaces:**
- Consumes: `processDraftAnswer` returning `{ message: string }` (Task 3 — no more `activated` field to check; `message-handler.ts` never read that field to begin with, so this is a non-change).

- [ ] **Step 1: Write the tests**

In `tests/bot/message-handler.test.ts`, the existing `describe('campanha em rascunho', ...)` block has a test `'ativa a campanha quando a resposta completa a extração'` that asserts `campaign?.status).toBe('active')` — this is no longer true (drafts never self-activate). Replace that whole `describe('campanha em rascunho', ...)` block with:

```typescript
  describe('campanha em rascunho', () => {
    async function makeDraftCampaign() {
      const draftCampaign = await createCampaign(pool, {
        guildId: 'guild-1',
        channelId: 'channel-draft',
        name: 'Campanha em rascunho',
        rulesetConfig: defaultRulesetConfig(),
        sourceDocument: 'documento original da campanha',
        status: 'draft',
      });
      await createCharacter(pool, {
        campaignId: draftCampaign.id,
        playerDiscordId: 'player-1',
        sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
      });
      return draftCampaign;
    }

    it('trata a mensagem como resposta de revisão em vez de chamar o LLM narrativo', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
        lore: 'Uma torre antiga.',
        rulesetConfig: defaultRulesetConfig(),
        clarifyingQuestions: ['Qual é o dado de dano? Sugiro d6.'],
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de teste é d20');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(llmProvider.runTurn).not.toHaveBeenCalled();
      expect(message._replies[0]).toMatch(/qual é o dado de dano/i);
    });

    it('nunca ativa a campanha sozinha, mesmo quando a extração fica completa', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockResolvedValue({
        lore: 'Uma torre antiga.',
        rulesetConfig: defaultRulesetConfig(),
        clarifyingQuestions: [],
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de dano é d6');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-draft');
      expect(campaign?.status).toBe('draft');
      expect(message._replies[0]).toMatch(/\/iniciar-campanha/);
    });

    it('responde com mensagem amigável quando o processamento falha', async () => {
      vi.spyOn(ingestion, 'extractResolvedConfig').mockRejectedValue(new Error('boom'));
      const llmProvider = makeLlmProvider();
      const message = makeMessage('o dado de teste é d20');
      message.channelId = 'channel-draft';
      await makeDraftCampaign();

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(message._replies[0]).toMatch(/não consegui processar/i);
    });
  });

  describe('campanha pausada', () => {
    it('ignora mensagens no canal, sem chamar o LLM nem responder', async () => {
      await createCampaign(pool, {
        guildId: 'guild-1',
        channelId: 'channel-paused',
        name: 'Campanha pausada',
        rulesetConfig: defaultRulesetConfig(),
        status: 'paused',
      });
      const llmProvider = makeLlmProvider();
      const message = makeMessage('alguém aí?');
      message.channelId = 'channel-paused';

      await handleMessage(message, pool, llmProvider, claudeClient);

      expect(llmProvider.runTurn).not.toHaveBeenCalled();
      expect(message._replies).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/bot/message-handler.test.ts`
Expected: PASS, all of them, including `'campanha pausada'` — this is the confirmation that the current code already produces the right behavior for all four new tests without any change yet. This step exists to prove the claim in the note above, not to find a failure to fix.

- [ ] **Step 3: Implement (clarity refactor, no behavior change)**

In `src/bot/message-handler.ts`, change:

```typescript
  if (campaign.status === 'draft') {
    try {
      const result = await processDraftAnswer(pool, claudeClient, campaign, message.content);
      await message.reply(result.message);
    } catch (err) {
      console.error('Erro ao processar resposta da campanha em rascunho:', err);
      try {
        await message.reply('Não consegui processar sua resposta agora. Tente de novo, ou use `/responder-campanha`.');
      } catch (replyErr) {
        console.error('Erro ao enviar mensagem de fallback:', replyErr);
      }
    }
    return;
  }

  if (campaign.status !== 'active') return;
```

to:

```typescript
  if (campaign.status === 'paused') return;

  if (campaign.status === 'draft') {
    try {
      const result = await processDraftAnswer(pool, claudeClient, campaign, message.content);
      await message.reply(result.message);
    } catch (err) {
      console.error('Erro ao processar resposta da campanha em rascunho:', err);
      try {
        await message.reply('Não consegui processar sua resposta agora. Tente de novo, ou use `/responder-campanha`.');
      } catch (replyErr) {
        console.error('Erro ao enviar mensagem de fallback:', replyErr);
      }
    }
    return;
  }
```

The trailing `if (campaign.status !== 'active') return;` guard is dropped: with three possible statuses now (`draft`/`active`/`paused`) and `draft`/`paused` both handled explicitly above with an early `return`, anything reaching that point is necessarily `active` already, so the blanket check added nothing beyond what the two explicit branches above it already guarantee.

No import changes are needed in `src/bot/message-handler.ts` for this task — it never imported `validation-messages.ts`. `tests/bot/message-handler.test.ts` already imports `createCampaign`, `getCampaignByChannel`, `createCharacter`, `defaultRulesetConfig`, and `ingestion` (namespace import of `../../src/ingestion/extract`), and already defines the `claudeClient` fixture and a `describe('campanha em rascunho', ...)` block from prior work on this codebase — no new imports are needed for the test additions in Step 1.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bot/message-handler.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/message-handler.ts tests/bot/message-handler.test.ts
git commit -m "refactor(bot): make paused-campaign message handling explicit, add regression tests"
```

---

### Task 6: `/iniciar-campanha` command

**Files:**
- Create: `src/bot/commands/iniciar-campanha.ts`
- Test: `tests/bot/commands/iniciar-campanha.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `activateCampaign` from `../../db/campaigns-repo` (Task 1).
- Produces: `export const data: SlashCommandBuilder`; `export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>` — consumed by Task 8 (router + registration wiring).

- [ ] **Step 1: Write the failing test**

Create `tests/bot/commands/iniciar-campanha.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/iniciar-campanha';

function makeInteraction(channelId = 'channel-1') {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/iniciar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('trava e ativa uma campanha em rascunho', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('active');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/iniciada/i);
  });

  it('avisa que a campanha já está em andamento quando já é active', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/já está em andamento/i);
  });

  it('avisa para usar /retomar-campanha quando está pausada', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const { pauseCampaign } = await import('../../../src/db/campaigns-repo');
    await pauseCampaign(pool, campaign.id);
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/retomar-campanha/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/iniciar-campanha.test.ts`
Expected: FAIL — cannot find module `../../../src/bot/commands/iniciar-campanha`.

- [ ] **Step 3: Implement**

Create `src/bot/commands/iniciar-campanha.ts`:

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, activateCampaign } from '../../db/campaigns-repo';

export const data = new SlashCommandBuilder()
  .setName('iniciar-campanha')
  .setDescription('Trava a configuração revisada e começa a sessão');

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return;
  }
  if (campaign.status === 'active') {
    await interaction.reply({ content: 'Essa campanha já está em andamento.', ephemeral: true });
    return;
  }
  if (campaign.status === 'paused') {
    await interaction.reply({ content: 'Essa campanha está pausada. Use `/retomar-campanha` para continuar.', ephemeral: true });
    return;
  }
  const activated = await activateCampaign(pool, campaign.id);
  await interaction.reply(
    `Campanha "${activated.name}" iniciada! A configuração está travada — boa sessão!\n\nSistema de regras: ${activated.rulesetConfig.name}.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/iniciar-campanha.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/iniciar-campanha.ts tests/bot/commands/iniciar-campanha.test.ts
git commit -m "feat(bot): add /iniciar-campanha to lock config and start the session"
```

---

### Task 7: `/pausar-campanha` command

**Files:**
- Create: `src/bot/commands/pausar-campanha.ts`
- Test: `tests/bot/commands/pausar-campanha.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `pauseCampaign` from `../../db/campaigns-repo` (Task 1).
- Produces: `export const data: SlashCommandBuilder`; `export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>` — consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/commands/pausar-campanha.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel, activateCampaign } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/pausar-campanha';

function makeInteraction(channelId = 'channel-1') {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/pausar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('pausa uma campanha ativa', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.status).toBe('paused');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/pausada/i);
  });

  it('avisa que ainda não começou quando está em draft', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/ainda não começou/i);
  });

  it('avisa que já está pausada quando chamado de novo', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction1 = makeInteraction();
    await execute(interaction1, pool);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool);
    expect(interaction2._lastReply.content ?? interaction2._lastReply).toMatch(/já está pausada/i);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/pausar-campanha.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/bot/commands/pausar-campanha.ts`:

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, pauseCampaign } from '../../db/campaigns-repo';

export const data = new SlashCommandBuilder()
  .setName('pausar-campanha')
  .setDescription('Pausa a sessão em andamento (a configuração permanece travada)');

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return;
  }
  if (campaign.status === 'draft') {
    await interaction.reply({ content: 'Essa campanha ainda não começou. Use `/iniciar-campanha`.', ephemeral: true });
    return;
  }
  if (campaign.status === 'paused') {
    await interaction.reply({ content: 'Essa campanha já está pausada.', ephemeral: true });
    return;
  }
  await pauseCampaign(pool, campaign.id);
  await interaction.reply(`Campanha "${campaign.name}" pausada. Use \`/retomar-campanha\` quando quiser continuar.`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/pausar-campanha.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/pausar-campanha.ts tests/bot/commands/pausar-campanha.test.ts
git commit -m "feat(bot): add /pausar-campanha"
```

---

### Task 8: `/retomar-campanha` command

**Files:**
- Create: `src/bot/commands/retomar-campanha.ts`
- Test: `tests/bot/commands/retomar-campanha.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `activateCampaign` from `../../db/campaigns-repo` (Task 1 — same `activateCampaign` used by `/iniciar-campanha`, since both transitions just set status to `active`).
- Produces: `export const data: SlashCommandBuilder`; `export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>` — consumed by Task 8's wiring... wait, this **is** part of the router wiring task below (Task 9 in file numbering after random lore) — see Task 11 for the actual wiring step; this task only creates the command in isolation.

- [ ] **Step 1: Write the failing test**

Create `tests/bot/commands/retomar-campanha.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, getCampaignByChannel, pauseCampaign } from '../../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/retomar-campanha';

function makeInteraction(channelId = 'channel-1') {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId,
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/retomar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('retoma uma campanha pausada', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await pauseCampaign(pool, campaign.id);
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.status).toBe('active');
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/em andamento|retomada/i);
  });

  it('avisa que já está em andamento quando já é active', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/já está em andamento/i);
  });

  it('avisa para usar /iniciar-campanha quando está em draft', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/iniciar-campanha/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = makeInteraction('channel-sem-campanha');
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/retomar-campanha.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/bot/commands/retomar-campanha.ts`:

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, activateCampaign } from '../../db/campaigns-repo';

export const data = new SlashCommandBuilder()
  .setName('retomar-campanha')
  .setDescription('Retoma uma sessão pausada');

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return;
  }
  if (campaign.status === 'active') {
    await interaction.reply({ content: 'Essa campanha já está em andamento.', ephemeral: true });
    return;
  }
  if (campaign.status === 'draft') {
    await interaction.reply({ content: 'Essa campanha ainda não começou. Use `/iniciar-campanha`.', ephemeral: true });
    return;
  }
  await activateCampaign(pool, campaign.id);
  await interaction.reply(`Campanha "${campaign.name}" retomada — bem-vindos de volta!`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/retomar-campanha.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/retomar-campanha.ts tests/bot/commands/retomar-campanha.test.ts
git commit -m "feat(bot): add /retomar-campanha"
```

---

### Task 9: Random lore generation for document-less `/criar-campanha`

**Files:**
- Modify: `src/ingestion/random-lore.ts` (replaces the Task 4 stub with the real implementation)
- Test: `tests/ingestion/random-lore.test.ts` (new file)
- Modify: `tests/bot/commands/criar-campanha.test.ts` (swap the placeholder spy added in Task 4 for real assertions)

**Interfaces:**
- Produces: `generateRandomLore(client: Anthropic): Promise<string>` (signature already fixed by the Task 4 stub — this task only changes the implementation body and adds real tests).

- [ ] **Step 1: Write the failing test**

Create `tests/ingestion/random-lore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/random-lore.test.ts`
Expected: FAIL — the current stub always throws `'generateRandomLore ainda não implementado'`, regardless of the mocked client response, so the first test fails (wrong error, no return value).

- [ ] **Step 3: Implement**

Replace the entire contents of `src/ingestion/random-lore.ts`:

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../config';

const RANDOM_LORE_PROMPT =
  'Invente um gancho de aventura curto e divertido para uma campanha de RPG de mesa genérica, em português, entre 2 e 4 frases. Seja criativo e variado — evite sempre começar da mesma forma. Responda só com o texto do gancho, sem título nem comentários extras.';

export async function generateRandomLore(client: Anthropic): Promise<string> {
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: RANDOM_LORE_PROMPT }],
  });
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) {
    throw new Error('O modelo não devolveu uma lore em texto.');
  }
  return block.text.trim();
}
```

Now fix the Task-4 workaround in `tests/bot/commands/criar-campanha.test.ts`: find the `beforeEach` (or wherever the `vi.spyOn(randomLore, 'generateRandomLore').mockResolvedValue('Uma lore de teste.')` line was added in Task 4) and leave it as-is — it's a legitimate mock of a now-real function, not a workaround anymore. No change needed there. If Task 4 instead only added the spy inline in the specific no-document test rather than a shared `beforeEach`, that's fine too; either way, no code change is required in this file for this task — just re-run the suite to confirm it's still green now that the underlying implementation is real.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ingestion/random-lore.test.ts tests/bot/commands/criar-campanha.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/random-lore.ts tests/ingestion/random-lore.test.ts
git commit -m "feat(ingestion): generate a real random lore hook for document-less campaigns"
```

---

### Task 10: `/minha-ficha` command

**Files:**
- Create: `src/bot/commands/minha-ficha.ts`
- Test: `tests/bot/commands/minha-ficha.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel` from `../../db/campaigns-repo`; `getCharacterByPlayer` from `../../db/characters-repo`.
- Produces: `export const data: SlashCommandBuilder`; `export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>` — consumed by Task 11 (wiring).

- [ ] **Step 1: Write the failing test**

Create `tests/bot/commands/minha-ficha.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign } from '../../../src/db/campaigns-repo';
import { createCharacter } from '../../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { execute } from '../../../src/bot/commands/minha-ficha';

function makeInteraction(publico: boolean | null = null) {
  const replies: unknown[] = [];
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: 'player-1' },
    options: { getBoolean: () => publico },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    get _lastReply() {
      return replies[replies.length - 1];
    },
  } as any;
}

describe('/minha-ficha execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 10 }, inventory: ['espada'] },
    });
  });

  it('mostra a ficha de forma efêmera por padrão', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool);
    expect(interaction._lastReply.ephemeral).toBe(true);
    expect(interaction._lastReply.content).toMatch(/Aria/);
    expect(interaction._lastReply.content).toMatch(/forca: 3/);
    expect(interaction._lastReply.content).toMatch(/hp: 10/);
    expect(interaction._lastReply.content).toMatch(/espada/);
  });

  it('mostra a ficha publicamente quando publico=true', async () => {
    const interaction = makeInteraction(true);
    await execute(interaction, pool);
    expect(interaction._lastReply.ephemeral).toBe(false);
  });

  it('mostra "vazio" quando o inventário está vazio', async () => {
    const otherPool = createTestPool();
    const campaign = await createCampaign(otherPool, {
      guildId: 'guild-2',
      channelId: 'channel-2',
      name: 'Outra Campanha',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(otherPool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-2',
      sheet: { name: 'Bram', attributes: { forca: 2 }, resources: { hp: 8 }, inventory: [] },
    });
    const interaction = { ...makeInteraction(), guildId: 'guild-2', channelId: 'channel-2', user: { id: 'player-2' } };
    await execute(interaction, otherPool);
    expect(interaction._lastReply.content).toMatch(/vazio/i);
  });

  it('avisa quando o jogador não tem ficha nesta campanha', async () => {
    const interaction = { ...makeInteraction(), user: { id: 'player-sem-ficha' } };
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/criar-personagem/);
  });

  it('avisa quando não há campanha no canal', async () => {
    const interaction = { ...makeInteraction(), channelId: 'channel-sem-campanha' };
    await execute(interaction, pool);
    expect(interaction._lastReply.content ?? interaction._lastReply).toMatch(/nenhuma campanha/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/minha-ficha.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

Create `src/bot/commands/minha-ficha.ts`:

```typescript
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer } from '../../db/characters-repo';

export const data = new SlashCommandBuilder()
  .setName('minha-ficha')
  .setDescription('Mostra sua ficha de personagem nesta campanha')
  .addBooleanOption((opt) =>
    opt.setName('publico').setDescription('Mostrar a ficha para todos no canal (padrão: só você vê)').setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return;
  }
  const character = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: 'Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.',
      ephemeral: true,
    });
    return;
  }
  const publico = interaction.options.getBoolean('publico') ?? false;
  const attrLines = Object.entries(character.sheet.attributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const resourceLines = Object.entries(character.sheet.resources)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const inventoryLine = character.sheet.inventory.length > 0 ? character.sheet.inventory.join(', ') : 'vazio';
  const content = [
    `**${character.sheet.name}**`,
    `Atributos:\n${attrLines}`,
    `Recursos:\n${resourceLines}`,
    `Inventário: ${inventoryLine}`,
  ].join('\n\n');
  await interaction.reply({ content, ephemeral: !publico });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/minha-ficha.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/minha-ficha.ts tests/bot/commands/minha-ficha.test.ts
git commit -m "feat(bot): add /minha-ficha for players to check their own sheet"
```

---

### Task 11: Wire the four new commands into the router and command registration

**Files:**
- Modify: `src/bot/interaction-router.ts`
- Modify: `scripts/register-commands.ts`
- Test: `tests/bot/interaction-router.test.ts`

**Interfaces:**
- Consumes: `execute`/`data` exports from `iniciar-campanha.ts` (Task 6), `pausar-campanha.ts` (Task 7), `retomar-campanha.ts` (Task 8), `minha-ficha.ts` (Task 10).

- [ ] **Step 1: Write the failing test**

The current `tests/bot/interaction-router.test.ts` mocks each command module with a per-test `vi.spyOn(moduleNamespace, 'execute').mockResolvedValue(undefined)`, not a top-level `vi.mock(...)` — match that exact pattern. Add four namespace imports after the existing ones — change:

```typescript
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';
import * as iniciarCombate from '../../src/bot/commands/iniciar-combate';
import * as responderCampanha from '../../src/bot/commands/responder-campanha';
```

to:

```typescript
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';
import * as iniciarCombate from '../../src/bot/commands/iniciar-combate';
import * as responderCampanha from '../../src/bot/commands/responder-campanha';
import * as iniciarCampanha from '../../src/bot/commands/iniciar-campanha';
import * as pausarCampanha from '../../src/bot/commands/pausar-campanha';
import * as retomarCampanha from '../../src/bot/commands/retomar-campanha';
import * as minhaFicha from '../../src/bot/commands/minha-ficha';
```

Add four tests right after the existing `'despacha /responder-campanha para responderCampanha.execute'` test and before `'ignora comandos desconhecidos sem lançar erro'`:

```typescript
  it('despacha /iniciar-campanha para iniciarCampanha.execute', async () => {
    const spy = vi.spyOn(iniciarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'iniciar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /pausar-campanha para pausarCampanha.execute', async () => {
    const spy = vi.spyOn(pausarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'pausar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /retomar-campanha para retomarCampanha.execute', async () => {
    const spy = vi.spyOn(retomarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'retomar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /minha-ficha para minhaFicha.execute', async () => {
    const spy = vi.spyOn(minhaFicha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'minha-ficha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });
```

All four use the two-argument `(interaction, pool)` call form (matching `criar-personagem`/`iniciar-combate` in the existing file), since none of the four new commands touch `claudeClient`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/interaction-router.test.ts`
Expected: FAIL — `routeInteraction` doesn't dispatch these command names yet, so the mocked `execute` functions are never called.

- [ ] **Step 3: Implement**

In `src/bot/interaction-router.ts`, add the four imports after the existing command imports:

```typescript
import * as iniciarCampanha from './commands/iniciar-campanha';
import * as pausarCampanha from './commands/pausar-campanha';
import * as retomarCampanha from './commands/retomar-campanha';
import * as minhaFicha from './commands/minha-ficha';
```

Add four dispatch branches inside the `if (interaction.isChatInputCommand())` block, after the existing `responder-campanha` branch and before the closing `return;`:

```typescript
    if (interaction.commandName === 'iniciar-campanha') {
      await iniciarCampanha.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'pausar-campanha') {
      await pausarCampanha.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'retomar-campanha') {
      await retomarCampanha.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'minha-ficha') {
      await minhaFicha.execute(interaction, pool);
      return;
    }
```

In `scripts/register-commands.ts`, add the four imports after the existing command-data imports:

```typescript
import { data as iniciarCampanhaData } from '../src/bot/commands/iniciar-campanha';
import { data as pausarCampanhaData } from '../src/bot/commands/pausar-campanha';
import { data as retomarCampanhaData } from '../src/bot/commands/retomar-campanha';
import { data as minhaFichaData } from '../src/bot/commands/minha-ficha';
```

And add them to the `body` array passed to `rest.put`:

```typescript
    body: [
      criarCampanhaData.toJSON(),
      criarPersonagemData.toJSON(),
      iniciarCombateData.toJSON(),
      responderCampanhaData.toJSON(),
      iniciarCampanhaData.toJSON(),
      pausarCampanhaData.toJSON(),
      retomarCampanhaData.toJSON(),
      minhaFichaData.toJSON(),
    ],
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bot/interaction-router.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors.

Run the full suite: `npx vitest run`
Expected: all tests pass (this is the last task — the whole feature should be green end-to-end at this point).

- [ ] **Step 5: Commit**

```bash
git add src/bot/interaction-router.ts scripts/register-commands.ts tests/bot/interaction-router.test.ts
git commit -m "feat(bot): wire /iniciar-campanha, /pausar-campanha, /retomar-campanha, /minha-ficha into the router"
```

---

## After all tasks

Run the full suite one more time (`npx tsc --noEmit && npx vitest run`) and confirm everything is green. Then rebuild and restart the Docker Compose bot service (`docker compose up -d --build bot`) so the running instance picks up the new commands and behavior, and confirm the logs show a clean startup (`docker compose logs bot --tail 20`) with no `MODULE_NOT_FOUND` or intent errors, same verification pattern used throughout this session.
