# Memória em 3 camadas (Hard/Working/Short-term) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `sessionSummary` (blob de texto truncado por tamanho) por 3 camadas de memória narrativa: `lore` (Hard, inalterada), `ritmoAtual`/`proximoMarco`/`fatosCruciais` (Working, atualizados por um ciclo de reflexão a cada 10 mensagens), e `recentExchanges` (Short-term, buffer estruturado das últimas 5 trocas).

**Architecture:** A reflexão é sempre uma segunda chamada `llmProvider.runTurn`, separada da chamada narrativa do turno, oferecendo uma única tool nova (`atualizar_estado_narrativo`). Ela roda depois que a resposta já foi enviada ao jogador, nunca atrasa o turno principal, e qualquer falha (incluindo o modelo não chamar a tool) é um no-op silencioso — o estado anterior é preservado e o ciclo tenta de novo 10 mensagens depois.

**Tech Stack:** TypeScript (`strict`, `noUncheckedIndexedAccess`), Postgres (`pg`)/`pg-mem`, Vitest, o mesmo `LlmProvider` (Claude/Ollama) já usado no laço narrativo.

## Global Constraints

- `docs/superpowers/specs/2026-07-08-memoria-em-camadas-design.md` é a spec de referência — qualquer dúvida de comportamento se resolve por ela.
- `tsc --noEmit` e `npx vitest run` devem ficar limpos ao final de cada task (o projeto usa `strict: true` e `noUncheckedIndexedAccess: true`).
- Todo dado novo em JSONB é lido de volta já parseado pelo driver `pg` (mesmo padrão de `ruleset_config` hoje — sem `JSON.parse` manual na leitura, só `JSON.stringify` na escrita).
- Nunca force-push, nunca pule hooks, nunca use `--no-verify`. Um commit por task, ao final da task.
- `src/db/test-db.ts` já reaplica todas as migrações do zero em cada teste — uma migração nova em `src/db/migrations/` já fica disponível nos testes automaticamente, sem nenhuma outra mudança de setup.

---

## Task 1: Migração + `campaigns-repo.ts` (camada de dados)

**Files:**
- Create: `src/db/migrations/004_memoria_em_camadas.sql`
- Modify: `src/db/campaigns-repo.ts`
- Modify: `tests/db/campaigns-repo.test.ts`
- Modify: `tests/bot/commands/criar-personagem.test.ts:15-27`
- Modify: `tests/bot/commands/iniciar-combate.test.ts:10-22`
- Modify: `tests/ingestion/draft-flow.test.ts:84-96`

**Interfaces:**
- Produces: `interface RecentExchange { characterName: string; playerMessage: string; narration: string }`, `interface Campaign` (com `recentExchanges: RecentExchange[]`, `ritmoAtual: string`, `proximoMarco: string`, `fatosCruciais: string[]`, `messagesSinceReflection: number`, sem `sessionSummary`), `updateRecentExchanges(pool, campaignId, recentExchanges): Promise<Campaign>`, `updateNarrativeState(pool, campaignId, { ritmoAtual, proximoMarco, fatosCruciais }): Promise<void>`, `resetReflectionCounter(pool, campaignId): Promise<void>` — todas exportadas de `src/db/campaigns-repo.ts`, usadas pelas Tasks 2–6.

- [ ] **Step 1: Criar a migração**

Crie `src/db/migrations/004_memoria_em_camadas.sql`:

```sql
ALTER TABLE campaigns DROP COLUMN session_summary;
ALTER TABLE campaigns ADD COLUMN recent_exchanges JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN ritmo_atual TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN proximo_marco TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN fatos_cruciais JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN messages_since_reflection INT NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Escrever os testes que falham para `campaigns-repo.ts`**

Em `tests/db/campaigns-repo.test.ts`, troque a linha de import:

```ts
import { createCampaign, getCampaignByChannel, updateRecentExchanges, updateNarrativeState, saveDraftProgress, activateCampaign, pauseCampaign } from '../../src/db/campaigns-repo';
```

Substitua o teste `'atualiza o resumo da sessão de uma campanha'` por estes dois:

```ts
  it('atualiza as trocas recentes e incrementa o contador de reflexão', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const updated = await updateRecentExchanges(pool, campaign.id, [
      { characterName: 'Aria', playerMessage: 'eu entro na torre', narration: 'Você entra na torre.' },
    ]);
    expect(updated.recentExchanges).toEqual([
      { characterName: 'Aria', playerMessage: 'eu entro na torre', narration: 'Você entra na torre.' },
    ]);
    expect(updated.messagesSinceReflection).toBe(1);
  });

  it('atualiza o estado narrativo e zera o contador de reflexão', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await updateRecentExchanges(pool, campaign.id, [{ characterName: 'Aria', playerMessage: 'oi', narration: 'olá' }]);
    await updateNarrativeState(pool, campaign.id, {
      ritmoAtual: 'ação',
      proximoMarco: 'encontrar o goblin',
      fatosCruciais: ['o rei está morto'],
    });
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.ritmoAtual).toBe('ação');
    expect(updated?.proximoMarco).toBe('encontrar o goblin');
    expect(updated?.fatosCruciais).toEqual(['o rei está morto']);
    expect(updated?.messagesSinceReflection).toBe(0);
  });
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: FAIL (`updateRecentExchanges`/`updateNarrativeState` não existem ainda, ou o tipo `Campaign` não bate)

- [ ] **Step 4: Reescrever `src/db/campaigns-repo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ValidatedRulesetConfig } from '../rules-engine';

export type CampaignStatus = 'draft' | 'active' | 'paused';

export interface RecentExchange {
  characterName: string;
  playerMessage: string;
  narration: string;
}

export interface Campaign {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  status: CampaignStatus;
  rulesetConfig: ValidatedRulesetConfig;
  lore: string;
  recentExchanges: RecentExchange[];
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  messagesSinceReflection: number;
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
    rulesetConfig: row.ruleset_config as ValidatedRulesetConfig,
    lore: row.lore as string,
    recentExchanges: row.recent_exchanges as RecentExchange[],
    ritmoAtual: row.ritmo_atual as string,
    proximoMarco: row.proximo_marco as string,
    fatosCruciais: row.fatos_cruciais as string[],
    messagesSinceReflection: row.messages_since_reflection as number,
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
    rulesetConfig: ValidatedRulesetConfig;
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

export async function updateRecentExchanges(
  pool: Pool,
  campaignId: string,
  recentExchanges: RecentExchange[]
): Promise<Campaign> {
  const result = await pool.query(
    `UPDATE campaigns SET recent_exchanges = $2, messages_since_reflection = messages_since_reflection + 1
     WHERE id = $1 RETURNING *`,
    [campaignId, JSON.stringify(recentExchanges)]
  );
  return rowToCampaign(result.rows[0]);
}

export async function updateNarrativeState(
  pool: Pool,
  campaignId: string,
  params: { ritmoAtual: string; proximoMarco: string; fatosCruciais: string[] }
): Promise<void> {
  await pool.query(
    `UPDATE campaigns SET ritmo_atual = $2, proximo_marco = $3, fatos_cruciais = $4, messages_since_reflection = 0
     WHERE id = $1`,
    [campaignId, params.ritmoAtual, params.proximoMarco, JSON.stringify(params.fatosCruciais)]
  );
}

export async function resetReflectionCounter(pool: Pool, campaignId: string): Promise<void> {
  await pool.query(`UPDATE campaigns SET messages_since_reflection = 0 WHERE id = $1`, [campaignId]);
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

export async function activateCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}

export async function pauseCampaign(pool: Pool, campaignId: string): Promise<Campaign> {
  const result = await pool.query(`UPDATE campaigns SET status = 'paused' WHERE id = $1 RETURNING *`, [campaignId]);
  return rowToCampaign(result.rows[0]);
}
```

- [ ] **Step 5: Corrigir os 3 fixtures que constroem um `Campaign` literal**

Em `tests/bot/commands/criar-personagem.test.ts:15-27`, troque:

```ts
    lore: '',
    sessionSummary: '',
    sourceDocument: '',
    clarificationNotes: '',
```

por:

```ts
    lore: '',
    recentExchanges: [],
    ritmoAtual: '',
    proximoMarco: '',
    fatosCruciais: [],
    messagesSinceReflection: 0,
    sourceDocument: '',
    clarificationNotes: '',
```

Aplique exatamente a mesma troca em `tests/bot/commands/iniciar-combate.test.ts:10-22` e em `tests/ingestion/draft-flow.test.ts:84-96` (nesse último, o campo `lore` já tem valor `'Uma lore.'` — mantenha-o, só adicione os 4 campos novos e remova `sessionSummary`).

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em tudo (nenhum outro arquivo referencia `sessionSummary`/`updateSessionSummary` fora dos que ainda serão tratados nas Tasks 5 e 6 — `context.ts`/`context.test.ts` e `message-handler.ts`/`message-handler.test.ts` — então o typecheck vai falhar nesses dois arquivos até a Task 5/6 rodarem. Confirme que os únicos erros restantes são exatamente esses.)

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/004_memoria_em_camadas.sql src/db/campaigns-repo.ts tests/db/campaigns-repo.test.ts tests/bot/commands/criar-personagem.test.ts tests/bot/commands/iniciar-combate.test.ts tests/ingestion/draft-flow.test.ts
git commit -m "feat(db): substitui session_summary por recent_exchanges + estado narrativo (ritmo/marco/fatos)"
```

---

## Task 2: `short-term-memory.ts` (Short-term Context)

**Files:**
- Create: `src/llm/short-term-memory.ts`
- Create: `tests/llm/short-term-memory.test.ts`
- Delete: `src/llm/session-summary.ts`
- Delete: `tests/llm/session-summary.test.ts`

**Interfaces:**
- Consumes: `RecentExchange` (de `src/db/campaigns-repo.ts`, Task 1).
- Produces: `appendExchange(current: RecentExchange[], exchange: RecentExchange, maxSize = 5): RecentExchange[]`, usada pela Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/llm/short-term-memory.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `npx vitest run tests/llm/short-term-memory.test.ts`
Expected: FAIL (arquivo `src/llm/short-term-memory.ts` não existe)

- [ ] **Step 3: Implementar**

Crie `src/llm/short-term-memory.ts`:

```ts
import type { RecentExchange } from '../db/campaigns-repo';

export function appendExchange(
  current: RecentExchange[],
  exchange: RecentExchange,
  maxSize = 5
): RecentExchange[] {
  return [...current, exchange].slice(-maxSize);
}
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `npx vitest run tests/llm/short-term-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Remover os arquivos antigos**

```bash
git rm src/llm/session-summary.ts tests/llm/session-summary.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/llm/short-term-memory.ts tests/llm/short-term-memory.test.ts
git commit -m "feat(llm): substitui session-summary por short-term-memory (buffer estruturado de trocas)"
```

---

## Task 3: `ToolContext.narrativeMemory` + tool `atualizar_estado_narrativo`

**Files:**
- Modify: `src/llm/tools.ts`
- Create: `src/llm/narrative-memory.ts`
- Create: `tests/llm/narrative-memory.test.ts`

**Interfaces:**
- Consumes: `updateNarrativeState` (de `src/db/campaigns-repo.ts`, Task 1); `ToolContext`/`ToolDefinition` (de `src/llm/tools.ts`).
- Produces: `ToolContext.narrativeMemory?: { pool: Pool; campaignId: string }`; `atualizarEstadoNarrativoTool: ToolDefinition` (de `src/llm/narrative-memory.ts`), usada pela Task 4 e pela Task 6.

- [ ] **Step 1: Estender `ToolContext`**

Em `src/llm/tools.ts`, troque:

```ts
export interface ToolContext {
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
  combat?: { pool: Pool; campaignId: string };
}
```

por:

```ts
export interface ToolContext {
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
  combat?: { pool: Pool; campaignId: string };
  narrativeMemory?: { pool: Pool; campaignId: string };
}
```

- [ ] **Step 2: Escrever os testes que falham**

Crie `tests/llm/narrative-memory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter, type StoredCharacter } from '../../src/db/characters-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { atualizarEstadoNarrativoTool } from '../../src/llm/narrative-memory';
import type { ToolContext } from '../../src/llm/tools';

describe('atualizarEstadoNarrativoTool', () => {
  let pool: Pool;
  let campaignId: string;
  let aria: StoredCharacter;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
    aria = await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  function makeCtx(): ToolContext {
    return {
      config: defaultRulesetConfig(),
      actingCharacter: aria,
      rng: () => 0.5,
      narrativeMemory: { pool, campaignId },
    };
  }

  it('persiste ritmo_atual, proximo_marco e fatos_cruciais na campanha', async () => {
    await atualizarEstadoNarrativoTool.execute(
      { ritmo_atual: 'ação', proximo_marco: 'encontrar o goblin', fatos_cruciais: ['o rei está morto'] },
      makeCtx()
    );
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.ritmoAtual).toBe('ação');
    expect(campaign?.proximoMarco).toBe('encontrar o goblin');
    expect(campaign?.fatosCruciais).toEqual(['o rei está morto']);
  });

  it('zera messagesSinceReflection ao persistir', async () => {
    await atualizarEstadoNarrativoTool.execute(
      { ritmo_atual: 'ação', proximo_marco: 'x', fatos_cruciais: [] },
      makeCtx()
    );
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.messagesSinceReflection).toBe(0);
  });

  it('lança erro sem o contexto de memória narrativa', async () => {
    const ctx: ToolContext = { config: defaultRulesetConfig(), actingCharacter: aria, rng: () => 0.5 };
    await expect(
      atualizarEstadoNarrativoTool.execute({ ritmo_atual: 'x', proximo_marco: 'y', fatos_cruciais: [] }, ctx)
    ).rejects.toThrow(/contexto de memória narrativa/);
  });

  it('lança erro quando ritmo_atual não é string', async () => {
    await expect(
      atualizarEstadoNarrativoTool.execute({ ritmo_atual: 42, proximo_marco: 'y', fatos_cruciais: [] }, makeCtx())
    ).rejects.toThrow(/ritmo_atual/);
  });

  it('lança erro quando fatos_cruciais não é uma lista de strings', async () => {
    await expect(
      atualizarEstadoNarrativoTool.execute(
        { ritmo_atual: 'x', proximo_marco: 'y', fatos_cruciais: 'não é lista' },
        makeCtx()
      )
    ).rejects.toThrow(/fatos_cruciais/);
  });
});
```

- [ ] **Step 3: Rodar os testes para confirmar que falham**

Run: `npx vitest run tests/llm/narrative-memory.test.ts`
Expected: FAIL (`src/llm/narrative-memory.ts` não existe)

- [ ] **Step 4: Implementar `src/llm/narrative-memory.ts` (parte 1 — a tool)**

```ts
import { updateNarrativeState } from '../db/campaigns-repo';
import type { ToolContext, ToolDefinition } from './tools';

function requireNarrativeMemory(ctx: ToolContext) {
  if (!ctx.narrativeMemory) {
    throw new Error('Esta ferramenta só pode ser usada com o contexto de memória narrativa configurado.');
  }
  return ctx.narrativeMemory;
}

export const atualizarEstadoNarrativoTool: ToolDefinition = {
  name: 'atualizar_estado_narrativo',
  description:
    'Atualiza o estado narrativo da campanha: o ritmo atual da cena, a próxima meta narrativa planejada e a lista completa de fatos que ainda importam para a história. Sempre devolva a lista completa de fatos cruciais, mantendo os que continuam relevantes e removendo os que já não importam.',
  inputSchema: {
    type: 'object',
    properties: {
      ritmo_atual: { type: 'string', description: 'Ritmo atual da cena: ação, mistério, descanso, etc.' },
      proximo_marco: { type: 'string', description: 'Próxima meta narrativa de curto prazo planejada pelo mestre.' },
      fatos_cruciais: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista completa e atualizada de fatos que ainda importam para a história.',
      },
    },
    required: ['ritmo_atual', 'proximo_marco', 'fatos_cruciais'],
  },
  execute: async (input, ctx) => {
    const narrativeMemory = requireNarrativeMemory(ctx);
    const { ritmo_atual, proximo_marco, fatos_cruciais } = input as {
      ritmo_atual: unknown;
      proximo_marco: unknown;
      fatos_cruciais: unknown;
    };
    if (typeof ritmo_atual !== 'string') {
      throw new Error('Entrada inválida para atualizar_estado_narrativo: "ritmo_atual" deve ser uma string.');
    }
    if (typeof proximo_marco !== 'string') {
      throw new Error('Entrada inválida para atualizar_estado_narrativo: "proximo_marco" deve ser uma string.');
    }
    if (!Array.isArray(fatos_cruciais) || !fatos_cruciais.every((f) => typeof f === 'string')) {
      throw new Error('Entrada inválida para atualizar_estado_narrativo: "fatos_cruciais" deve ser uma lista de strings.');
    }
    await updateNarrativeState(narrativeMemory.pool, narrativeMemory.campaignId, {
      ritmoAtual: ritmo_atual,
      proximoMarco: proximo_marco,
      fatosCruciais: fatos_cruciais,
    });
    return { ritmoAtual: ritmo_atual, proximoMarco: proximo_marco, fatosCruciais: fatos_cruciais };
  },
};
```

- [ ] **Step 5: Rodar os testes para confirmar que passam**

Run: `npx vitest run tests/llm/narrative-memory.test.ts tests/llm/tools.test.ts && npx tsc --noEmit`
Expected: PASS (o `tsc` ainda vai acusar erro em `context.ts`/`message-handler.ts`, tratados nas Tasks 5/6 — confirme que os erros restantes são só nesses dois arquivos)

- [ ] **Step 6: Commit**

```bash
git add src/llm/tools.ts src/llm/narrative-memory.ts tests/llm/narrative-memory.test.ts
git commit -m "feat(llm): tool atualizar_estado_narrativo + ToolContext.narrativeMemory"
```

---

## Task 4: `buildReflectionPrompt` + `maybeRunReflection` (ciclo de reflexão)

**Files:**
- Modify: `src/llm/narrative-memory.ts`
- Modify: `tests/llm/narrative-memory.test.ts`

**Interfaces:**
- Consumes: `Campaign`, `RecentExchange`, `resetReflectionCounter` (de `src/db/campaigns-repo.ts`); `LlmProvider` (de `src/llm/provider.ts`); `Rng`, `ValidatedRulesetConfig` (de `src/rules-engine`); `StoredCharacter` (de `src/db/characters-repo.ts`); `atualizarEstadoNarrativoTool` (Task 3).
- Produces: `REFLECTION_INTERVAL = 10`; `buildReflectionPrompt(params): { system: string; user: string }`; `maybeRunReflection(params): Promise<void>` — usada pela Task 6.

- [ ] **Step 1: Escrever os testes que falham**

No topo de `tests/llm/narrative-memory.test.ts` (mesmo arquivo da Task 3), troque a linha:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
```

por:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

E acrescente, logo abaixo dos imports existentes:

```ts
import type { Campaign } from '../../src/db/campaigns-repo';
import type { LlmProvider } from '../../src/llm/provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
import { buildReflectionPrompt, maybeRunReflection, REFLECTION_INTERVAL } from '../../src/llm/narrative-memory';
```

Depois, acrescente ao final do arquivo (novos `describe`, mantendo o `atualizarEstadoNarrativoTool` já escrito na Task 3):

```ts
describe('buildReflectionPrompt', () => {
  it('inclui o estado atual e as trocas recentes no prompt', () => {
    const { system, user } = buildReflectionPrompt({
      ritmoAtual: 'ação',
      proximoMarco: 'encontrar o goblin',
      fatosCruciais: ['o rei está morto'],
      recentExchanges: [{ characterName: 'Aria', playerMessage: 'eu entro na sala', narration: 'Você entra na sala.' }],
    });
    expect(system).toMatch(/atualizar_estado_narrativo/);
    expect(user).toContain('ação');
    expect(user).toContain('encontrar o goblin');
    expect(user).toContain('o rei está morto');
    expect(user).toContain('eu entro na sala');
  });

  it('usa textos padrão quando o estado ainda está vazio', () => {
    const { user } = buildReflectionPrompt({ ritmoAtual: '', proximoMarco: '', fatosCruciais: [], recentExchanges: [] });
    expect(user).toMatch(/nenhum registrado ainda/);
  });
});

describe('maybeRunReflection', () => {
  let pool: Pool;
  let campaign: Campaign;
  let aria: StoredCharacter;

  beforeEach(async () => {
    pool = createTestPool();
    campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    aria = await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  function makeParams(overrides: { llmProvider: LlmProvider; messagesSinceReflection: number }) {
    return {
      pool,
      campaignId: campaign.id,
      campaign: { ...campaign, messagesSinceReflection: overrides.messagesSinceReflection },
      llmProvider: overrides.llmProvider,
      config: defaultRulesetConfig(),
      actingCharacter: aria,
      rng: () => 0.5,
    };
  }

  it('não chama o provedor quando o contador está abaixo do limiar', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn() };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL - 1 }));
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('chama o provedor e persiste o estado quando o contador atinge o limiar', async () => {
    const llmProvider: LlmProvider = {
      runTurn: vi.fn().mockImplementation(async (_system: string, _user: string, tools: ToolDefinition[], ctx: ToolContext) => {
        await tools[0]!.execute({ ritmo_atual: 'ação', proximo_marco: 'x', fatos_cruciais: ['y'] }, ctx);
        return { narration: '', toolCalls: [] };
      }),
    };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }));
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.ritmoAtual).toBe('ação');
  });

  it('zera o contador mesmo quando o modelo não chama a tool', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn().mockResolvedValue({ narration: 'só narrou', toolCalls: [] }) };
    await maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }));
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.messagesSinceReflection).toBe(0);
  });

  it('não propaga erro quando o provedor falha', async () => {
    const llmProvider: LlmProvider = { runTurn: vi.fn().mockRejectedValue(new Error('boom')) };
    await expect(
      maybeRunReflection(makeParams({ llmProvider, messagesSinceReflection: REFLECTION_INTERVAL }))
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run tests/llm/narrative-memory.test.ts`
Expected: FAIL (`buildReflectionPrompt`/`maybeRunReflection`/`REFLECTION_INTERVAL` não existem ainda)

- [ ] **Step 3: Acrescentar a `src/llm/narrative-memory.ts`**

Acrescente ao final do arquivo (mantendo o que a Task 3 já escreveu):

```ts
import type { Campaign, RecentExchange } from '../db/campaigns-repo';
import { resetReflectionCounter } from '../db/campaigns-repo';
import type { Pool } from 'pg';
import type { LlmProvider } from './provider';
import type { Rng, ValidatedRulesetConfig } from '../rules-engine';
import type { StoredCharacter } from '../db/characters-repo';

export const REFLECTION_INTERVAL = 10;

export function buildReflectionPrompt(params: {
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  recentExchanges: RecentExchange[];
}): { system: string; user: string } {
  const system = [
    'Você é o assistente de continuidade narrativa de uma campanha de RPG de mesa.',
    'Analise o estado atual e as trocas recentes entre jogador e mestre, e chame a ferramenta atualizar_estado_narrativo com o estado revisado.',
    'Sempre devolva a lista completa de fatos_cruciais: mantenha os que ainda importam para a história e remova os que já ficaram irrelevantes.',
    'Nunca narre a cena nem responda ao jogador diretamente — sua única saída deve ser a chamada da ferramenta.',
  ].join('\n');

  const exchangesText = params.recentExchanges
    .map((e) => `${e.characterName}: ${e.playerMessage}\nMestre: ${e.narration}`)
    .join('\n\n');

  const user = [
    `Ritmo atual registrado: ${params.ritmoAtual || '(nenhum registrado ainda)'}`,
    `Próximo marco registrado: ${params.proximoMarco || '(nenhum registrado ainda)'}`,
    `Fatos cruciais registrados: ${params.fatosCruciais.length ? params.fatosCruciais.join('; ') : '(nenhum registrado ainda)'}`,
    '',
    'Trocas recentes:',
    exchangesText || '(nenhuma troca registrada ainda)',
  ].join('\n');

  return { system, user };
}

export async function maybeRunReflection(params: {
  pool: Pool;
  campaignId: string;
  campaign: Campaign;
  llmProvider: LlmProvider;
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
}): Promise<void> {
  if (params.campaign.messagesSinceReflection < REFLECTION_INTERVAL) return;

  const { system, user } = buildReflectionPrompt({
    ritmoAtual: params.campaign.ritmoAtual,
    proximoMarco: params.campaign.proximoMarco,
    fatosCruciais: params.campaign.fatosCruciais,
    recentExchanges: params.campaign.recentExchanges,
  });

  try {
    await params.llmProvider.runTurn(system, user, [atualizarEstadoNarrativoTool], {
      config: params.config,
      actingCharacter: params.actingCharacter,
      rng: params.rng,
      narrativeMemory: { pool: params.pool, campaignId: params.campaignId },
    });
  } catch (err) {
    console.error('Erro ao rodar o ciclo de reflexão narrativa:', err);
  } finally {
    await resetReflectionCounter(params.pool, params.campaignId);
  }
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run tests/llm/narrative-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/narrative-memory.ts tests/llm/narrative-memory.test.ts
git commit -m "feat(llm): ciclo de reflexão (buildReflectionPrompt + maybeRunReflection)"
```

---

## Task 5: `buildSystemPrompt` (`context.ts`)

**Files:**
- Modify: `src/llm/context.ts`
- Modify: `tests/llm/context.test.ts`

**Interfaces:**
- Consumes: `RecentExchange` (de `src/db/campaigns-repo.ts`).
- Produces: `buildSystemPrompt(params: { campaignName, lore, ritmoAtual, proximoMarco, fatosCruciais, recentExchanges, rulesetName, inCombat? }): string`, usada pela Task 6.

- [ ] **Step 1: Reescrever `tests/llm/context.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/llm/context';

function baseParams(overrides: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): Parameters<typeof buildSystemPrompt>[0] {
  return {
    campaignName: 'X',
    lore: '',
    ritmoAtual: '',
    proximoMarco: '',
    fatosCruciais: [],
    recentExchanges: [],
    rulesetName: 'Y',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('inclui o nome da campanha e do sistema de regras', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        campaignName: 'A Torre Esquecida',
        lore: 'Uma torre antiga no meio da floresta.',
        rulesetName: 'Sistema Simplificado Padrão',
      })
    );
    expect(prompt).toContain('A Torre Esquecida');
    expect(prompt).toContain('Sistema Simplificado Padrão');
    expect(prompt).toContain('Uma torre antiga no meio da floresta.');
  });

  it('instrui o modelo a nunca inventar resultados de teste', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toMatch(/nunca invente/i);
  });

  it('usa textos padrão quando lore, fatos e trocas estão vazios', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toContain('nenhuma lore registrada ainda');
    expect(prompt).toContain('nenhum fato crucial registrado ainda');
    expect(prompt).toContain('primeira interação da campanha');
  });

  it('inclui instruções de combate quando inCombat é true', () => {
    const prompt = buildSystemPrompt(baseParams({ inCombat: true }));
    expect(prompt).toMatch(/resolver_ataque/);
    expect(prompt).toMatch(/avancar_turno/);
  });

  it('não menciona ferramentas de combate quando inCombat é false ou omitido', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).not.toMatch(/resolver_ataque/);
  });

  it('inclui fatos cruciais, ritmo atual e próximo marco quando presentes', () => {
    const prompt = buildSystemPrompt(
      baseParams({ fatosCruciais: ['o rei está morto'], ritmoAtual: 'ação', proximoMarco: 'encontrar o goblin' })
    );
    expect(prompt).toContain('o rei está morto');
    expect(prompt).toContain('ação');
    expect(prompt).toContain('encontrar o goblin');
  });

  it('inclui as últimas trocas da conversa quando presentes', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        recentExchanges: [{ characterName: 'Aria', playerMessage: 'eu entro na sala', narration: 'Você vê uma sala escura.' }],
      })
    );
    expect(prompt).toContain('Aria: eu entro na sala');
    expect(prompt).toContain('Você vê uma sala escura.');
  });
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run tests/llm/context.test.ts`
Expected: FAIL (assinatura de `buildSystemPrompt` ainda espera `sessionSummary`)

- [ ] **Step 3: Reescrever `src/llm/context.ts`**

```ts
import type { RecentExchange } from '../db/campaigns-repo';

export function buildSystemPrompt(params: {
  campaignName: string;
  lore: string;
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  recentExchanges: RecentExchange[];
  rulesetName: string;
  inCombat?: boolean;
}): string {
  const lines = [
    `Você é o mestre de um RPG de mesa chamado "${params.campaignName}", usando o sistema de regras "${params.rulesetName}".`,
    'Narre a aventura de forma envolvente e consistente com o histórico da campanha.',
    'Sempre que uma ação do jogador tiver resultado incerto, use a ferramenta fazer_teste em vez de inventar um resultado.',
    'Nunca invente valores de atributos, recursos ou resultados de dado — sempre use as ferramentas disponíveis para isso.',
  ];
  if (params.inCombat) {
    lines.push(
      'Um combate está em andamento. Use resolver_ataque para resolver ataques contra um alvo, aplicar_dano para aplicar o dano resultante ao alvo certo, e avancar_turno ao final da ação do jogador atual para passar a vez.'
    );
  }
  lines.push(
    '',
    'Cenário e história até agora:',
    params.lore || '(nenhuma lore registrada ainda)',
    '',
    'Fatos importantes registrados até agora:',
    params.fatosCruciais.length
      ? params.fatosCruciais.map((f) => `- ${f}`).join('\n')
      : '(nenhum fato crucial registrado ainda)',
    '',
    'Ritmo atual da cena:',
    params.ritmoAtual || '(ainda não avaliado)',
    '',
    'Próximo marco planejado:',
    params.proximoMarco || '(ainda não definido)',
    '',
    'Últimas trocas da conversa:',
    params.recentExchanges.length
      ? params.recentExchanges.map((e) => `${e.characterName}: ${e.playerMessage}\nMestre: ${e.narration}`).join('\n\n')
      : '(esta é a primeira interação da campanha)'
  );
  return lines.join('\n');
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `npx vitest run tests/llm/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/context.ts tests/llm/context.test.ts
git commit -m "feat(llm): buildSystemPrompt renderiza as 3 camadas de memória (lore/working/short-term)"
```

---

## Task 6: `message-handler.ts` (wiring completo)

**Files:**
- Modify: `src/bot/message-handler.ts`
- Modify: `tests/bot/message-handler.test.ts`

**Interfaces:**
- Consumes: `updateRecentExchanges` (Task 1), `appendExchange` (Task 2), `maybeRunReflection` (Task 4), `buildSystemPrompt` (Task 5).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/bot/message-handler.test.ts`, troque a linha de import existente `import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';` por:

```ts
import { createCampaign, getCampaignByChannel, updateRecentExchanges } from '../../src/db/campaigns-repo';
```

E acrescente, junto dos demais imports de tipo já existentes (perto de `import type { LlmProvider } from '../../src/llm/provider';`):

```ts
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
```

Substitua o teste `'atualiza o resumo da sessão após a resposta'` por:

```ts
  it('acrescenta a troca ao buffer de curto prazo após a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.recentExchanges).toEqual([
      { characterName: 'Aria', playerMessage: 'eu examino a sala', narration: 'Você vê uma sala empoeirada.' },
    ]);
  });
```

Substitua o teste `'não atualiza o resumo da sessão quando o runTurn falha'` por:

```ts
  it('não acrescenta troca ao buffer quando o runTurn falha', async () => {
    const llmProvider = makeLlmProvider({
      runTurn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const message = makeMessage('eu examino a sala');
    const campaignBefore = await getCampaignByChannel(pool, 'guild-1', 'channel-1');

    await handleMessage(message, pool, llmProvider, claudeClient);

    const campaignAfter = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaignAfter?.recentExchanges).toEqual(campaignBefore?.recentExchanges);
  });
```

Acrescente, ao final do arquivo (antes do último `});` que fecha o `describe('handleMessage', ...)`), um novo bloco:

```ts
  describe('reflexão narrativa periódica', () => {
    async function primeReflectionCounter(times: number) {
      for (let i = 0; i < times; i++) {
        await updateRecentExchanges(pool, campaignId, []);
      }
    }

    it('não dispara reflexão antes de atingir o limiar de mensagens', async () => {
      await primeReflectionCounter(8);
      const llmProvider = makeLlmProvider();
      const message = makeMessage('eu examino a sala');
      await handleMessage(message, pool, llmProvider, claudeClient);
      expect((llmProvider.runTurn as any).mock.calls.length).toBe(1);
    });

    it('dispara uma segunda chamada de reflexão ao atingir o limiar e persiste o estado', async () => {
      await primeReflectionCounter(9);
      const llmProvider: LlmProvider = {
        runTurn: vi
          .fn()
          .mockResolvedValueOnce({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] })
          .mockImplementationOnce(async (_system: string, _user: string, tools: ToolDefinition[], ctx: ToolContext) => {
            await tools[0]!.execute(
              { ritmo_atual: 'ação', proximo_marco: 'encontrar o goblin', fatos_cruciais: ['o rei está morto'] },
              ctx
            );
            return { narration: '', toolCalls: [] };
          }),
      };
      const message = makeMessage('eu examino a sala');
      await handleMessage(message, pool, llmProvider, claudeClient);
      expect((llmProvider.runTurn as any).mock.calls.length).toBe(2);
      const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
      expect(campaign?.ritmoAtual).toBe('ação');
      expect(campaign?.proximoMarco).toBe('encontrar o goblin');
    });

    it('não propaga erro nem impede a resposta quando a reflexão falha', async () => {
      await primeReflectionCounter(9);
      const llmProvider: LlmProvider = {
        runTurn: vi
          .fn()
          .mockResolvedValueOnce({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] })
          .mockRejectedValueOnce(new Error('boom')),
      };
      const message = makeMessage('eu examino a sala');
      await expect(handleMessage(message, pool, llmProvider, claudeClient)).resolves.toBeUndefined();
      expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
    });
  });
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `npx vitest run tests/bot/message-handler.test.ts`
Expected: FAIL (`message-handler.ts` ainda usa `sessionSummary`/`updateSessionSummary`/`appendToSessionSummary`, que não existem mais)

- [ ] **Step 3: Reescrever `src/bot/message-handler.ts`**

```ts
import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel, updateRecentExchanges } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import { getCombatState } from '../db/combat-repo';
import type { LlmProvider } from '../llm/provider';
import { fazerTesteTool, consultarFichaTool, type ToolDefinition } from '../llm/tools';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../llm/combat-tools';
import { buildSystemPrompt } from '../llm/context';
import { appendExchange } from '../llm/short-term-memory';
import { maybeRunReflection } from '../llm/narrative-memory';
import { processDraftAnswer } from '../ingestion/draft-flow';
import { splitDiscordMessage } from './discord-text';
import { turnoAtual } from '../rules-engine';

export async function handleMessage(
  message: Message,
  pool: Pool,
  llmProvider: LlmProvider,
  claudeClient: Anthropic
): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const campaign = await getCampaignByChannel(pool, message.guildId, message.channelId);
  if (!campaign) return;

  if (campaign.status === 'paused') return;

  if (campaign.status === 'draft') {
    try {
      const result = await processDraftAnswer(pool, claudeClient, campaign, message.content);
      const { first, rest } = splitDiscordMessage(result.message);
      await message.reply(first);
      for (const chunk of rest) {
        await message.reply(chunk);
      }
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

  const character = await getCharacterByPlayer(pool, campaign.id, message.author.id);
  if (!character) {
    await message.reply('Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.');
    return;
  }

  const combatState = await getCombatState(pool, campaign.id);
  let tools: ToolDefinition[] = [fazerTesteTool, consultarFichaTool];
  let combatContext: { pool: Pool; campaignId: string } | undefined;

  if (combatState) {
    const currentCombatant = turnoAtual({ order: combatState.order, currentIndex: combatState.currentIndex });
    const actingCombatant = combatState.combatants.find((c) => c.characterId === character.id);
    if (!actingCombatant || actingCombatant.id !== currentCombatant.id) {
      await message.reply(`Ainda não é sua vez. É a vez de **${currentCombatant.name}**.`);
      return;
    }
    tools = [...tools, resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool];
    combatContext = { pool, campaignId: campaign.id };
  }

  const systemPrompt = buildSystemPrompt({
    campaignName: campaign.name,
    lore: campaign.lore,
    ritmoAtual: campaign.ritmoAtual,
    proximoMarco: campaign.proximoMarco,
    fatosCruciais: campaign.fatosCruciais,
    recentExchanges: campaign.recentExchanges,
    rulesetName: campaign.rulesetConfig.name,
    inCombat: Boolean(combatState),
  });

  try {
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping().catch(() => {});
    }
    const result = await llmProvider.runTurn(systemPrompt, message.content, tools, {
      config: campaign.rulesetConfig,
      actingCharacter: character,
      rng: Math.random,
      combat: combatContext,
    });

    await message.reply(result.narration);

    const updatedExchanges = appendExchange(campaign.recentExchanges, {
      characterName: character.sheet.name,
      playerMessage: message.content,
      narration: result.narration,
    });
    const updatedCampaign = await updateRecentExchanges(pool, campaign.id, updatedExchanges);

    await maybeRunReflection({
      pool,
      campaignId: campaign.id,
      campaign: updatedCampaign,
      llmProvider,
      config: campaign.rulesetConfig,
      actingCharacter: character,
      rng: Math.random,
    });
  } catch (err) {
    console.error('Erro ao processar turno do LLM:', err);
    try {
      await message.reply('O mestre teve um problema para responder. Tente novamente em instantes.');
    } catch (replyErr) {
      console.error('Erro ao enviar mensagem de fallback:', replyErr);
    }
  }
}
```

Note que `updateRecentExchanges` já devolve a `Campaign` com `messagesSinceReflection` incrementado (via `RETURNING *`), então `maybeRunReflection` sempre recebe o contador correto e atualizado — sem precisar reler do banco nem recalcular `+1` manualmente.

- [ ] **Step 4: Rodar a suíte inteira e o typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em tudo, sem nenhum erro restante em nenhum arquivo.

- [ ] **Step 5: Commit**

```bash
git add src/bot/message-handler.ts tests/bot/message-handler.test.ts
git commit -m "feat(bot): liga o buffer de curto prazo e o ciclo de reflexão ao laço narrativo"
```

---

## Task 7: Revisão final e README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Conferir a suíte completa uma última vez**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em tudo.

- [ ] **Step 2: Revisão de branch inteira**

Compare o diff completo desta feature (`git log` desde antes da Task 1) contra `docs/superpowers/specs/2026-07-08-memoria-em-camadas-design.md` e contra este plano. Confirme especificamente:
- Nenhuma referência restante a `sessionSummary`/`session_summary`/`updateSessionSummary`/`appendToSessionSummary` em `src/` ou `tests/` (`grep -rn "sessionSummary\|session_summary" src/ tests/` deve devolver vazio).
- O ciclo de reflexão nunca atrasa nem impede a resposta ao jogador (a chamada a `maybeRunReflection` acontece só depois de `message.reply(result.narration)`).
- O no-op silencioso (modelo não chama a tool) está coberto por teste e realmente não lança erro.

- [ ] **Step 3: Atualizar o README**

Acrescente uma entrada na seção `## Status` do `README.md`, no mesmo estilo das entradas de planos existentes (ex: a linha do Plano 6), descrevendo em uma frase: memória narrativa dividida em 3 camadas (lore fixa, estado de trama via reflexão periódica a cada 10 mensagens, buffer das últimas 5 trocas), substituindo o antigo resumo de sessão truncado por tamanho.

- [ ] **Step 4: Commit e push**

```bash
git add README.md
git commit -m "docs: atualiza README com a memória em 3 camadas (Plano 7)"
git push origin main
```
