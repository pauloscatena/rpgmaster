# Combate por Turnos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar combate por turnos com iniciativa: `/iniciar-combate` monta os combatentes e calcula a ordem, o bot recusa ações fora de turno antes de envolver o Claude, e três novas tools (`resolver_ataque`, `aplicar_dano`, `avancar_turno`) dão ao Claude acesso à mecânica de combate sem nunca inventar números.

**Architecture:** O estado de combate (ordem de iniciativa, combatentes, turno atual) é persistido em Postgres por campanha. As novas tools de combate são apenas mais `ToolDefinition`s adicionadas à lista existente do orquestrador (Plano 3) — o laço de tool-calling em si não muda. O handler de mensagens verifica de quem é o turno **antes** de chamar o Claude; se não for a vez do autor da mensagem, o bot recusa a ação diretamente.

**Tech Stack:** Node.js 20+, TypeScript, discord.js v14, `pg`/`pg-mem`, `@anthropic-ai/sdk`, Vitest.

## Global Constraints

- Depende dos Planos 1 (motor de regras), 2 (bot + persistência) e 3 (laço narrativo) já implementados.
- Ações fora de turno são recusadas pelo código do bot, sem passar pelo Claude decidir.
- Dano aplicado a um combatente que é um personagem de jogador é sempre persistido de volta na tabela `characters`, para que a ficha continue correta fora do combate.
- Mesma regra do Plano 1: o LLM nunca calcula números de combate diretamente — sempre via `resolver_ataque` e `aplicar_dano`.
- Migrações SQL passam a ser aplicadas de forma incremental e idempotente (nem todo arquivo de migração pode rodar mais de uma vez sem seu próprio controle).

---

## Estrutura de arquivos

```
RPGMaster/
  scripts/
    migrate.ts                     # MODIFICADO: aplica migrações incrementalmente
  src/
    db/
      migrations/
        002_combat_combatants.sql
      test-db.ts                   # MODIFICADO: aplica todas as migrações em ordem
      combat-repo.ts
      characters-repo.ts           # MODIFICADO: getCharactersByCampaign, updateCharacterResources
    llm/
      tools.ts                     # MODIFICADO: ToolContext ganha campo `combat`
      combat-tools.ts
      context.ts                   # MODIFICADO: buildSystemPrompt ganha `inCombat`
    bot/
      message-handler.ts           # MODIFICADO: enforcement de turno + tools de combate
      interaction-router.ts        # MODIFICADO: despacha /iniciar-combate
      commands/
        iniciar-combate.ts
  tests/
    db/
      combat-repo.test.ts
      characters-repo.test.ts      # MODIFICADO
    llm/
      combat-tools.test.ts
      context.test.ts              # MODIFICADO
    bot/
      message-handler.test.ts      # MODIFICADO
      interaction-router.test.ts   # MODIFICADO
      commands/
        iniciar-combate.test.ts
```

---

### Task 1: Migração de combate e migration runner idempotente

**Files:**
- Create: `src/db/migrations/002_combat_combatants.sql`
- Modify: `src/db/test-db.ts` (Plano 2, Task 1)
- Modify: `scripts/migrate.ts` (Plano 2, Task 8)
- Test: `tests/db/test-db.test.ts` (Plano 2, Task 1) — adicionar caso cobrindo a nova coluna

**Interfaces:**
- Produces: coluna `combat_states.combatants_json` disponível para o Task 2 deste plano.

- [ ] **Step 1: Escrever teste falho cobrindo a nova coluna**

Adicionar ao final de `tests/db/test-db.test.ts`:
```ts
  it('aplica a migração de combate e permite inserir combatants_json', async () => {
    const pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('c1', 'g1', 'ch1', 'Teste', 'active', '{}', '')`
    );
    const result = await pool.query(
      `INSERT INTO combat_states (campaign_id, order_json, current_index, combatants_json)
       VALUES ('c1', '[]', 0, '[]')
       RETURNING combatants_json`
    );
    expect(result.rows[0].combatants_json).toEqual([]);
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/db/test-db.test.ts`
Expected: FAIL — a coluna `combatants_json` não existe ainda.

- [ ] **Step 3: Criar a migração e tornar `test-db.ts`/`migrate.ts` incrementais**

`src/db/migrations/002_combat_combatants.sql`:
```sql
ALTER TABLE combat_states ADD COLUMN combatants_json JSONB NOT NULL DEFAULT '[]';
```

Substituir `src/db/test-db.ts` inteiro por:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const schema = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.public.none(schema);
  }
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}
```

Substituir `scripts/migrate.ts` inteiro por:
```ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { loadConfig } from '../src/config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  );
  const migrationsDir = path.join(__dirname, '../src/db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const already = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [file]);
    if (already.rows.length > 0) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
    await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file]);
    console.log(`Aplicada: ${file}`);
  }
  console.log('Migrações em dia.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/test-db.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar a suíte inteira para garantir que nada quebrou**

Run: `npx vitest run`
Expected: PASS em todos os testes dos Planos 1-3.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/002_combat_combatants.sql src/db/test-db.ts scripts/migrate.ts tests/db/test-db.test.ts
git commit -m "feat: add combat combatants column and make migrations incremental"
```

---

### Task 2: Repositório de combate e extensões do repositório de personagens

**Files:**
- Create: `src/db/combat-repo.ts`
- Modify: `src/db/characters-repo.ts` (Plano 2, Task 3)
- Test: `tests/db/combat-repo.test.ts`
- Modify: `tests/db/characters-repo.test.ts` (Plano 2, Task 3)

**Interfaces:**
- Consumes: `CharacterSheet` de `src/rules-engine`; `Combatant` de `src/rules-engine` (só o tipo, para `order`); `StoredCharacter` de `characters-repo.ts`.
- Produces: `interface CombatCombatant { id: string; name: string; isNpc: boolean; characterId?: string; sheet: CharacterSheet }`; `interface StoredCombatState { campaignId: string; combatants: CombatCombatant[]; order: Combatant[]; currentIndex: number }`; `async function saveCombatState(pool: Pool, state: StoredCombatState): Promise<void>`; `async function getCombatState(pool: Pool, campaignId: string): Promise<StoredCombatState | null>`; `async function clearCombatState(pool: Pool, campaignId: string): Promise<void>`; e em `characters-repo.ts`: `async function getCharactersByCampaign(pool: Pool, campaignId: string): Promise<StoredCharacter[]>`, `async function updateCharacterResources(pool: Pool, characterId: string, resources: Record<string, number>): Promise<StoredCharacter>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/db/combat-repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { saveCombatState, getCombatState, clearCombatState, type StoredCombatState } from '../../src/db/combat-repo';

describe('combat-repo', () => {
  let pool: Pool;
  let campaignId: string;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
  });

  function makeState(): StoredCombatState {
    return {
      campaignId,
      combatants: [
        {
          id: 'char-1',
          name: 'Aria',
          isNpc: false,
          characterId: 'char-1',
          sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
        },
        {
          id: 'npc-1',
          name: 'Goblin',
          isNpc: true,
          sheet: { name: 'Goblin', attributes: { forca: 1, destreza: 1, intelecto: 1 }, resources: { hp: 11 }, inventory: [] },
        },
      ],
      order: [
        { id: 'npc-1', name: 'Goblin', initiative: 15 },
        { id: 'char-1', name: 'Aria', initiative: 10 },
      ],
      currentIndex: 0,
    };
  }

  it('salva e recupera o estado de combate de uma campanha', async () => {
    await saveCombatState(pool, makeState());
    const found = await getCombatState(pool, campaignId);
    expect(found).toEqual(makeState());
  });

  it('retorna null quando não há combate em andamento', async () => {
    const found = await getCombatState(pool, campaignId);
    expect(found).toBeNull();
  });

  it('sobrescreve o estado existente ao salvar novamente', async () => {
    await saveCombatState(pool, makeState());
    await saveCombatState(pool, { ...makeState(), currentIndex: 1 });
    const found = await getCombatState(pool, campaignId);
    expect(found?.currentIndex).toBe(1);
  });

  it('remove o estado de combate', async () => {
    await saveCombatState(pool, makeState());
    await clearCombatState(pool, campaignId);
    const found = await getCombatState(pool, campaignId);
    expect(found).toBeNull();
  });
});
```

Adicionar ao final do `describe('characters-repo', ...)` em `tests/db/characters-repo.test.ts`, e importar `getCharactersByCampaign, updateCharacterResources` no topo do arquivo:
```ts
  it('lista todos os personagens de uma campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-2', sheet: { ...ariaSheet, name: 'Bram' } });
    const characters = await getCharactersByCampaign(pool, 'camp-1');
    expect(characters.map((c) => c.sheet.name).sort()).toEqual(['Aria', 'Bram']);
  });

  it('atualiza os recursos de um personagem', async () => {
    const stored = await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    const updated = await updateCharacterResources(pool, stored.id, { hp: 5 });
    expect(updated.sheet.resources).toEqual({ hp: 5 });
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/db/combat-repo.test.ts tests/db/characters-repo.test.ts`
Expected: FAIL — `combat-repo.ts` não existe e `getCharactersByCampaign`/`updateCharacterResources` não são exportados.

- [ ] **Step 3: Implementar**

`src/db/combat-repo.ts`:
```ts
import type { Pool } from 'pg';
import type { CharacterSheet, Combatant } from '../rules-engine';

export interface CombatCombatant {
  id: string;
  name: string;
  isNpc: boolean;
  characterId?: string;
  sheet: CharacterSheet;
}

export interface StoredCombatState {
  campaignId: string;
  combatants: CombatCombatant[];
  order: Combatant[];
  currentIndex: number;
}

function rowToState(row: Record<string, unknown>): StoredCombatState {
  return {
    campaignId: row.campaign_id as string,
    combatants: row.combatants_json as CombatCombatant[],
    order: row.order_json as Combatant[],
    currentIndex: row.current_index as number,
  };
}

export async function saveCombatState(pool: Pool, state: StoredCombatState): Promise<void> {
  await pool.query(
    `INSERT INTO combat_states (campaign_id, order_json, current_index, combatants_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id) DO UPDATE
       SET order_json = $2, current_index = $3, combatants_json = $4, updated_at = now()`,
    [state.campaignId, JSON.stringify(state.order), state.currentIndex, JSON.stringify(state.combatants)]
  );
}

export async function getCombatState(pool: Pool, campaignId: string): Promise<StoredCombatState | null> {
  const result = await pool.query(`SELECT * FROM combat_states WHERE campaign_id = $1`, [campaignId]);
  return result.rows[0] ? rowToState(result.rows[0]) : null;
}

export async function clearCombatState(pool: Pool, campaignId: string): Promise<void> {
  await pool.query(`DELETE FROM combat_states WHERE campaign_id = $1`, [campaignId]);
}
```

Adicionar ao final de `src/db/characters-repo.ts`:
```ts
export async function getCharactersByCampaign(pool: Pool, campaignId: string): Promise<StoredCharacter[]> {
  const result = await pool.query(`SELECT * FROM characters WHERE campaign_id = $1`, [campaignId]);
  return result.rows.map(rowToCharacter);
}

export async function updateCharacterResources(
  pool: Pool,
  characterId: string,
  resources: Record<string, number>
): Promise<StoredCharacter> {
  const result = await pool.query(`UPDATE characters SET resources = $2 WHERE id = $1 RETURNING *`, [
    characterId,
    JSON.stringify(resources),
  ]);
  return rowToCharacter(result.rows[0]);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/combat-repo.test.ts tests/db/characters-repo.test.ts`
Expected: PASS (4 + 6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/db/combat-repo.ts src/db/characters-repo.ts tests/db/combat-repo.test.ts tests/db/characters-repo.test.ts
git commit -m "feat: add combat state repository and character roster/resource queries"
```

---

### Task 3: Tools de combate

**Files:**
- Modify: `src/llm/tools.ts` (Plano 3, Task 2) — `ToolContext` ganha `combat?: { pool: Pool; campaignId: string }`
- Create: `src/llm/combat-tools.ts`
- Test: `tests/llm/combat-tools.test.ts`

**Interfaces:**
- Consumes: `resolverAtaque`, `aplicarDano`, `avancarTurno`, `turnoAtual` de `src/rules-engine` (Plano 1); `getCombatState`, `saveCombatState` de `src/db/combat-repo.ts` (Task 2); `updateCharacterResources` de `src/db/characters-repo.ts` (Task 2); `ToolContext`, `ToolDefinition` de `src/llm/tools.ts`.
- Produces: `const resolverAtaqueTool: ToolDefinition`; `const aplicarDanoTool: ToolDefinition`; `const avancarTurnoTool: ToolDefinition`.

- [ ] **Step 1: Escrever testes falhos**

Adicionar `import type { Pool } from 'pg';` no topo de `src/llm/tools.ts` e alterar a interface `ToolContext` (mostrado no Step 3). Antes disso, escrever:

`tests/llm/combat-tools.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign } from '../../src/db/campaigns-repo';
import { createCharacter, getCharacterByPlayer, type StoredCharacter } from '../../src/db/characters-repo';
import { saveCombatState, getCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../../src/llm/combat-tools';
import type { ToolContext } from '../../src/llm/tools';

describe('combat tools', () => {
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
    const goblinSheet = createCharacterSheet(campaign.rulesetConfig, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: aria.id, name: 'Aria', isNpc: false, characterId: aria.id, sheet: aria.sheet },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: goblinSheet },
      ],
      order: [
        { id: aria.id, name: 'Aria', initiative: 15 },
        { id: 'npc-1', name: 'Goblin', initiative: 10 },
      ],
      currentIndex: 0,
    });
  });

  function makeCtx(): ToolContext {
    return { config: defaultRulesetConfig(), actingCharacter: aria, rng: () => 0.5, combat: { pool, campaignId } };
  }

  it('resolver_ataque encontra o alvo pelo nome e resolve o teste de ataque', async () => {
    const result = (await resolverAtaqueTool.execute({ targetName: 'Goblin' }, makeCtx())) as {
      targetId: string;
      hit: boolean;
      damage: number;
    };
    expect(result.targetId).toBe('npc-1');
    expect(result.hit).toBe(true);
    expect(result.damage).toBeGreaterThan(0);
  });

  it('resolver_ataque lança erro quando o alvo não existe', async () => {
    await expect(resolverAtaqueTool.execute({ targetName: 'Ninguém' }, makeCtx())).rejects.toThrow(/não encontrado/);
  });

  it('aplicar_dano subtrai o dano do alvo e persiste no personagem quando é jogador', async () => {
    await aplicarDanoTool.execute({ targetId: aria.id, amount: 5 }, makeCtx());
    const updatedCharacter = await getCharacterByPlayer(pool, campaignId, 'player-1');
    expect(updatedCharacter?.sheet.resources.hp).toBe(aria.sheet.resources.hp - 5);
    const state = await getCombatState(pool, campaignId);
    const combatant = state?.combatants.find((c) => c.id === aria.id);
    expect(combatant?.sheet.resources.hp).toBe(aria.sheet.resources.hp - 5);
  });

  it('aplicar_dano não persiste em characters quando o alvo é NPC', async () => {
    await aplicarDanoTool.execute({ targetId: 'npc-1', amount: 5 }, makeCtx());
    const state = await getCombatState(pool, campaignId);
    const combatant = state?.combatants.find((c) => c.id === 'npc-1');
    expect(combatant?.sheet.resources.hp).toBe(6);
  });

  it('avancar_turno avança para o próximo combatente e persiste', async () => {
    const result = (await avancarTurnoTool.execute({}, makeCtx())) as { id: string; name: string };
    expect(result.name).toBe('Goblin');
    const state = await getCombatState(pool, campaignId);
    expect(state?.currentIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/combat-tools.test.ts`
Expected: FAIL — `combat-tools.ts` não existe e `ToolContext` ainda não tem `combat`.

- [ ] **Step 3: Modificar `ToolContext` e implementar `combat-tools.ts`**

Em `src/llm/tools.ts`, adicionar o import `import type { Pool } from 'pg';` no topo e alterar a interface `ToolContext` para:
```ts
export interface ToolContext {
  config: RulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
  combat?: { pool: Pool; campaignId: string };
}
```

`src/llm/combat-tools.ts`:
```ts
import { aplicarDano, avancarTurno, resolverAtaque, turnoAtual } from '../rules-engine';
import { getCombatState, saveCombatState } from '../db/combat-repo';
import { updateCharacterResources } from '../db/characters-repo';
import type { ToolContext, ToolDefinition } from './tools';

function requireCombat(ctx: ToolContext) {
  if (!ctx.combat) throw new Error('Esta ferramenta só pode ser usada durante um combate.');
  return ctx.combat;
}

export const resolverAtaqueTool: ToolDefinition = {
  name: 'resolver_ataque',
  description:
    'Resolve o ataque do personagem que está agindo contra um alvo do combate. Devolve se acertou e, se acertou, o dano causado. Sempre use esta ferramenta antes de aplicar dano em um ataque.',
  inputSchema: {
    type: 'object',
    properties: {
      targetName: { type: 'string', description: 'Nome do alvo do ataque, como aparece na lista de combatentes.' },
    },
    required: ['targetName'],
  },
  execute: async (input, ctx) => {
    const combat = requireCombat(ctx);
    const { targetName } = input as { targetName: string };
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const target = state.combatants.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
    if (!target) throw new Error(`Alvo "${targetName}" não encontrado no combate.`);
    const result = resolverAtaque(ctx.config, ctx.actingCharacter.sheet, ctx.rng);
    return { targetId: target.id, targetName: target.name, ...result };
  },
};

export const aplicarDanoTool: ToolDefinition = {
  name: 'aplicar_dano',
  description:
    'Aplica uma quantidade de dano ao recurso de pontos de vida de um alvo do combate, identificado pelo targetId devolvido por resolver_ataque.',
  inputSchema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Id do alvo, devolvido por resolver_ataque.' },
      amount: { type: 'number', description: 'Quantidade de dano a aplicar.' },
    },
    required: ['targetId', 'amount'],
  },
  execute: async (input, ctx) => {
    const combat = requireCombat(ctx);
    const { targetId, amount } = input as { targetId: string; amount: number };
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const index = state.combatants.findIndex((c) => c.id === targetId);
    if (index === -1) throw new Error(`Alvo com id "${targetId}" não encontrado no combate.`);
    const target = state.combatants[index];
    const updatedSheet = aplicarDano(ctx.config, target.sheet, amount);
    const updatedCombatants = [...state.combatants];
    updatedCombatants[index] = { ...target, sheet: updatedSheet };
    await saveCombatState(combat.pool, { ...state, combatants: updatedCombatants });
    if (target.characterId) {
      await updateCharacterResources(combat.pool, target.characterId, updatedSheet.resources);
    }
    return { targetId, targetName: target.name, resources: updatedSheet.resources };
  },
};

export const avancarTurnoTool: ToolDefinition = {
  name: 'avancar_turno',
  description:
    'Avança o combate para o próximo combatente na ordem de iniciativa. Use ao final da ação do personagem que está agindo.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async (_input, ctx) => {
    const combat = requireCombat(ctx);
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const nextState = avancarTurno({ order: state.order, currentIndex: state.currentIndex });
    await saveCombatState(combat.pool, { ...state, currentIndex: nextState.currentIndex });
    return turnoAtual(nextState);
  },
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/combat-tools.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Rodar a suíte inteira (o `ToolContext` mudou)**

Run: `npx vitest run`
Expected: PASS em todos os testes — `combat` é opcional, então os testes dos Planos 1-3 continuam válidos sem alteração.

- [ ] **Step 6: Commit**

```bash
git add src/llm/tools.ts src/llm/combat-tools.ts tests/llm/combat-tools.test.ts
git commit -m "feat: add resolver_ataque, aplicar_dano and avancar_turno tools"
```

---

### Task 4: Comando `/iniciar-combate`

**Files:**
- Create: `src/bot/commands/iniciar-combate.ts`
- Test: `tests/bot/commands/iniciar-combate.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `Campaign` de `src/db/campaigns-repo.ts`; `getCharactersByCampaign` de `src/db/characters-repo.ts` (Task 2); `saveCombatState`, `CombatCombatant` de `src/db/combat-repo.ts` (Task 2); `calcularIniciativa`, `createCharacterSheet`, `turnoAtual` de `src/rules-engine`.
- Produces: `export const data: SlashCommandBuilder` (nome `iniciar-combate`, opção string `inimigo` obrigatória); `function buildEnemyModal(campaign: Campaign, enemyName: string): ModalBuilder`; `async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>`; `async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/commands/iniciar-combate.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, type Campaign } from '../../../src/db/campaigns-repo';
import { createCharacter } from '../../../src/db/characters-repo';
import { getCombatState } from '../../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../../src/rules-engine';
import { buildEnemyModal, execute, handleModalSubmit } from '../../../src/bot/commands/iniciar-combate';

describe('buildEnemyModal', () => {
  const campaign: Campaign = {
    id: 'camp-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    name: 'Teste',
    status: 'active',
    rulesetConfig: defaultRulesetConfig(),
    lore: '',
    sessionSummary: '',
  };

  it('gera um customId codificando campanha e nome do inimigo', () => {
    const modal = buildEnemyModal(campaign, 'Goblin');
    expect(modal.toJSON().custom_id).toBe('iniciar-combate:camp-1:Goblin');
  });
});

describe('/iniciar-combate execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    await createCharacter(pool, {
      campaignId: campaign.id,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  it('mostra o modal do inimigo quando há ao menos um personagem na campanha', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      options: { getString: () => 'Goblin' },
      showModal,
      reply: vi.fn(),
    } as any;
    await execute(interaction, pool);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('recusa quando nenhum personagem foi criado na campanha', async () => {
    const otherPool = createTestPool();
    await createCampaign(otherPool, {
      guildId: 'guild-2',
      channelId: 'channel-2',
      name: 'Sem personagens',
      rulesetConfig: defaultRulesetConfig(),
    });
    const reply = vi.fn();
    const interaction = {
      guildId: 'guild-2',
      channelId: 'channel-2',
      options: { getString: () => 'Goblin' },
      showModal: vi.fn(),
      reply,
    } as any;
    await execute(interaction, otherPool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/ninguém tem personagem/i) }));
  });
});

describe('/iniciar-combate handleModalSubmit', () => {
  let pool: Pool;
  let campaignId: string;

  beforeEach(async () => {
    pool = createTestPool();
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    campaignId = campaign.id;
    await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
  });

  it('calcula a iniciativa, salva o estado de combate e anuncia a ordem', async () => {
    const values: Record<string, string> = { forca: '1', destreza: '1', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `iniciar-combate:${campaignId}:Goblin`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    const state = await getCombatState(pool, campaignId);
    expect(state?.combatants.map((c) => c.name).sort()).toEqual(['Aria', 'Goblin']);
    expect(state?.order.length).toBe(2);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/combate iniciado/i));
  });

  it('recusa quando um atributo do inimigo não é numérico', async () => {
    const values: Record<string, string> = { forca: 'muito', destreza: '1', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `iniciar-combate:${campaignId}:Goblin`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/forca/i) }));
    const state = await getCombatState(pool, campaignId);
    expect(state).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/iniciar-combate.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `iniciar-combate.ts`**

`src/bot/commands/iniciar-combate.ts`:
```ts
import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, type Campaign } from '../../db/campaigns-repo';
import { getCharactersByCampaign } from '../../db/characters-repo';
import { saveCombatState, type CombatCombatant } from '../../db/combat-repo';
import { calcularIniciativa, createCharacterSheet, turnoAtual } from '../../rules-engine';

export const data = new SlashCommandBuilder()
  .setName('iniciar-combate')
  .setDescription('Inicia um combate nesta campanha')
  .addStringOption((opt) => opt.setName('inimigo').setDescription('Nome do inimigo').setRequired(true));

export function buildEnemyModal(campaign: Campaign, enemyName: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`iniciar-combate:${campaign.id}:${enemyName}`)
    .setTitle(`Atributos de ${enemyName}`);
  const rows = campaign.rulesetConfig.attributes.map((attr) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(attr).setLabel(attr).setStyle(TextInputStyle.Short).setRequired(true)
    )
  );
  modal.addComponents(...rows);
  return modal;
}

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'active') {
    await interaction.reply({ content: 'Nenhuma campanha ativa neste canal.', ephemeral: true });
    return;
  }
  const characters = await getCharactersByCampaign(pool, campaign.id);
  if (characters.length === 0) {
    await interaction.reply({ content: 'Ninguém tem personagem nesta campanha ainda.', ephemeral: true });
    return;
  }
  const inimigo = interaction.options.getString('inimigo', true);
  await interaction.showModal(buildEnemyModal(campaign, inimigo));
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void> {
  const [, campaignId, enemyName] = interaction.customId.split(':');
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) return;
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.id !== campaignId) {
    await interaction.reply({ content: 'Campanha não encontrada.', ephemeral: true });
    return;
  }
  const attributeValues: Record<string, number> = {};
  for (const attr of campaign.rulesetConfig.attributes) {
    const raw = interaction.fields.getTextInputValue(attr);
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      await interaction.reply({ content: `Valor inválido para o atributo "${attr}": deve ser um número.`, ephemeral: true });
      return;
    }
    attributeValues[attr] = value;
  }
  const enemySheet = createCharacterSheet(campaign.rulesetConfig, enemyName, attributeValues);
  const characters = await getCharactersByCampaign(pool, campaign.id);

  const combatants: CombatCombatant[] = [
    ...characters.map((c) => ({ id: c.id, name: c.sheet.name, isNpc: false, characterId: c.id, sheet: c.sheet })),
    { id: randomUUID(), name: enemyName, isNpc: true, sheet: enemySheet },
  ];

  const state = calcularIniciativa(
    campaign.rulesetConfig,
    combatants.map((c) => ({ id: c.id, name: c.name, character: c.sheet }))
  );

  await saveCombatState(pool, {
    campaignId: campaign.id,
    combatants,
    order: state.order,
    currentIndex: state.currentIndex,
  });

  const first = turnoAtual(state);
  const ordem = state.order.map((c, i) => `${i + 1}. ${c.name} (iniciativa ${c.initiative})`).join('\n');
  await interaction.reply(`Combate iniciado!\n${ordem}\n\nÉ a vez de **${first.name}**.`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/commands/iniciar-combate.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/iniciar-combate.ts tests/bot/commands/iniciar-combate.test.ts
git commit -m "feat: add /iniciar-combate command"
```

---

### Task 5: Enforcement de turno e tools de combate no handler de mensagens

**Files:**
- Modify: `src/llm/context.ts` (Plano 3, Task 4) — `buildSystemPrompt` ganha `inCombat`
- Modify: `tests/llm/context.test.ts` (Plano 3, Task 4)
- Modify: `src/bot/message-handler.ts` (Plano 3, Task 6)
- Modify: `tests/bot/message-handler.test.ts` (Plano 3, Task 6)

**Interfaces:**
- Consumes: `getCombatState` de `src/db/combat-repo.ts` (Task 2); `resolverAtaqueTool`, `aplicarDanoTool`, `avancarTurnoTool` de `src/llm/combat-tools.ts` (Task 3); `turnoAtual` de `src/rules-engine`.
- Produces: `buildSystemPrompt` aceita `inCombat?: boolean`; `handleMessage` recusa ações fora de turno antes de chamar o Claude e injeta as tools de combate quando há combate ativo.

- [ ] **Step 1: Escrever testes falhos**

Adicionar a `tests/llm/context.test.ts`:
```ts
  it('inclui instruções de combate quando inCombat é true', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y', inCombat: true });
    expect(prompt).toMatch(/resolver_ataque/);
    expect(prompt).toMatch(/avancar_turno/);
  });

  it('não menciona ferramentas de combate quando inCombat é false ou omitido', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y' });
    expect(prompt).not.toMatch(/resolver_ataque/);
  });
```

Substituir `tests/bot/message-handler.test.ts` inteiro por:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { saveCombatState } from '../../src/db/combat-repo';
import { defaultRulesetConfig, createCharacterSheet } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import * as orchestrator from '../../src/llm/orchestrator';

describe('handleMessage', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;
  let campaignId: string;
  let ariaId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createTestPool();
    await createCampaign(pool, { guildId: 'guild-1', channelId: 'channel-1', name: 'Teste', rulesetConfig: defaultRulesetConfig() });
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    campaignId = campaign!.id;
    const aria = await createCharacter(pool, {
      campaignId,
      playerDiscordId: 'player-1',
      sheet: createCharacterSheet(campaign!.rulesetConfig, 'Aria', { forca: 3, destreza: 2, intelecto: 1 }),
    });
    ariaId = aria.id;
  });

  function makeMessage(content: string, authorId = 'player-1', isBot = false) {
    const replies: string[] = [];
    return {
      author: { id: authorId, bot: isBot },
      guildId: 'guild-1',
      channelId: 'channel-1',
      content,
      reply: async (text: string) => {
        replies.push(text);
      },
      _replies: replies,
    } as any;
  }

  it('ignora mensagens de outros bots', async () => {
    const spy = vi.spyOn(orchestrator, 'runGameMasterTurn');
    await handleMessage(makeMessage('oi', 'bot-1', true), pool, claudeClient);
    expect(spy).not.toHaveBeenCalled();
  });

  it('pede para criar personagem quando o autor não tem ficha na campanha', async () => {
    const message = makeMessage('eu examino a sala', 'player-sem-ficha');
    await handleMessage(message, pool, claudeClient);
    expect(message._replies[0]).toMatch(/criar-personagem/);
  });

  it('fora de combate, chama o orquestrador e responde com a narração', async () => {
    vi.spyOn(orchestrator, 'runGameMasterTurn').mockResolvedValue({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] });
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('em combate, recusa a ação quando não é o turno do autor', async () => {
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: ariaId, name: 'Aria', isNpc: false, characterId: ariaId, sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }) },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: createCharacterSheet(defaultRulesetConfig(), 'Goblin', { forca: 1, destreza: 1, intelecto: 1 }) },
      ],
      order: [
        { id: 'npc-1', name: 'Goblin', initiative: 15 },
        { id: ariaId, name: 'Aria', initiative: 10 },
      ],
      currentIndex: 0,
    });
    const spy = vi.spyOn(orchestrator, 'runGameMasterTurn');
    const message = makeMessage('eu ataco o goblin');
    await handleMessage(message, pool, claudeClient);
    expect(spy).not.toHaveBeenCalled();
    expect(message._replies[0]).toMatch(/não é sua vez/i);
    expect(message._replies[0]).toMatch(/goblin/i);
  });

  it('em combate, na vez do autor, chama o orquestrador com as tools de combate', async () => {
    await saveCombatState(pool, {
      campaignId,
      combatants: [
        { id: ariaId, name: 'Aria', isNpc: false, characterId: ariaId, sheet: createCharacterSheet(defaultRulesetConfig(), 'Aria', { forca: 3, destreza: 2, intelecto: 1 }) },
        { id: 'npc-1', name: 'Goblin', isNpc: true, sheet: createCharacterSheet(defaultRulesetConfig(), 'Goblin', { forca: 1, destreza: 1, intelecto: 1 }) },
      ],
      order: [
        { id: ariaId, name: 'Aria', initiative: 15 },
        { id: 'npc-1', name: 'Goblin', initiative: 10 },
      ],
      currentIndex: 0,
    });
    const spy = vi.spyOn(orchestrator, 'runGameMasterTurn').mockResolvedValue({ narration: 'Você ataca o goblin!', toolCalls: [] });
    const message = makeMessage('eu ataco o goblin');
    await handleMessage(message, pool, claudeClient);
    expect(message._replies[0]).toBe('Você ataca o goblin!');
    const toolsArg = spy.mock.calls[0][3] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(
      expect.arrayContaining(['fazer_teste', 'consultar_ficha', 'resolver_ataque', 'aplicar_dano', 'avancar_turno'])
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/context.test.ts tests/bot/message-handler.test.ts`
Expected: FAIL — `inCombat` ainda não é suportado e o enforcement de turno ainda não existe.

- [ ] **Step 3: Implementar**

Substituir `src/llm/context.ts` inteiro por:
```ts
export function buildSystemPrompt(params: {
  campaignName: string;
  lore: string;
  sessionSummary: string;
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
    'Resumo da sessão até o momento:',
    params.sessionSummary || '(esta é a primeira interação da campanha)'
  );
  return lines.join('\n');
}
```

Substituir `src/bot/message-handler.ts` inteiro por:
```ts
import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel, updateSessionSummary } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import { getCombatState } from '../db/combat-repo';
import * as orchestrator from '../llm/orchestrator';
import { fazerTesteTool, consultarFichaTool, type ToolDefinition } from '../llm/tools';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../llm/combat-tools';
import { buildSystemPrompt } from '../llm/context';
import { appendToSessionSummary } from '../llm/session-summary';
import { turnoAtual } from '../rules-engine';

export async function handleMessage(message: Message, pool: Pool, claudeClient: Anthropic): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const campaign = await getCampaignByChannel(pool, message.guildId, message.channelId);
  if (!campaign || campaign.status !== 'active') return;

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
    sessionSummary: campaign.sessionSummary,
    rulesetName: campaign.rulesetConfig.name,
    inCombat: Boolean(combatState),
  });

  const result = await orchestrator.runGameMasterTurn(claudeClient, systemPrompt, message.content, tools, {
    config: campaign.rulesetConfig,
    actingCharacter: character,
    rng: Math.random,
    combat: combatContext,
  });

  await message.reply(result.narration);

  const exchange = `${character.sheet.name}: ${message.content}\nMestre: ${result.narration}`;
  const updatedSummary = appendToSessionSummary(campaign.sessionSummary, exchange);
  await updateSessionSummary(pool, campaign.id, updatedSummary);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/context.test.ts tests/bot/message-handler.test.ts`
Expected: PASS (5 + 5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/context.ts src/bot/message-handler.ts tests/llm/context.test.ts tests/bot/message-handler.test.ts
git commit -m "feat: enforce turn order and wire combat tools into the message handler"
```

---

### Task 6: Roteador de interações e smoke test manual de combate

**Files:**
- Modify: `src/bot/interaction-router.ts` (Plano 2, Task 7)
- Modify: `tests/bot/interaction-router.test.ts` (Plano 2, Task 7)
- Modify: `scripts/register-commands.ts` (Plano 2, Task 8)

**Interfaces:**
- Consumes: `execute`, `handleModalSubmit` de `src/bot/commands/iniciar-combate.ts` (Task 4).

- [ ] **Step 1: Escrever testes falhos**

Adicionar a `tests/bot/interaction-router.test.ts` (e importar `* as iniciarCombate from '../../src/bot/commands/iniciar-combate'` no topo):
```ts
  it('despacha /iniciar-combate para iniciarCombate.execute', async () => {
    const spy = vi.spyOn(iniciarCombate, 'execute').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'iniciar-combate',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal iniciar-combate:* para iniciarCombate.handleModalSubmit', async () => {
    const spy = vi.spyOn(iniciarCombate, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: 'iniciar-combate:abc123:Goblin',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/interaction-router.test.ts`
Expected: FAIL — `/iniciar-combate` ainda não é despachado.

- [ ] **Step 3: Implementar**

Substituir `src/bot/interaction-router.ts` inteiro por:
```ts
import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';
import * as iniciarCombate from './commands/iniciar-combate';

export async function routeInteraction(interaction: Interaction, pool: Pool): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool);
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

Em `scripts/register-commands.ts`, adicionar o import `import { data as iniciarCombateData } from '../src/bot/commands/iniciar-combate';` e incluir `iniciarCombateData.toJSON()` no array `body`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em todos os testes (Planos 1-4), sem erros de tipo.

- [ ] **Step 5: Smoke test manual de combate completo**

1. Rodar `npm run register-commands` novamente para publicar `/iniciar-combate`.
2. No servidor de teste, com uma campanha e ao menos um personagem já criados, rodar `/iniciar-combate inimigo:Goblin` e preencher o modal com atributos do inimigo.
3. Confirmar que o bot anuncia a ordem de iniciativa e de quem é a vez.
4. Se não for a vez do seu personagem, escrever uma ação no canal e confirmar que o bot recusa dizendo de quem é a vez, sem gerar nenhuma narração do Claude.
5. Quando for sua vez, escrever uma ação de ataque (ex: "eu ataco o goblin com minha espada") e confirmar que a narração reflete acerto/erro e dano de forma coerente, e que o turno avança para o próximo combatente.
6. Repetir até o inimigo chegar a 0 de HP e confirmar que a ficha do personagem (fora de combate) reflete corretamente qualquer dano recebido durante a luta.

- [ ] **Step 6: Commit**

```bash
git add src/bot/interaction-router.ts tests/bot/interaction-router.test.ts scripts/register-commands.ts
git commit -m "feat: dispatch /iniciar-combate through the interaction router"
```

---

## Self-Review

**Cobertura da spec:** cobre o fluxo de combate do design — cálculo de iniciativa, anúncio de turno, recusa de ações fora de ordem sem envolver o Claude, e as tools `resolver_ataque`/`aplicar_dano`/`avancar_turno` operando sobre estado determinístico em Postgres. A persistência de dano de volta para a ficha do jogador garante consistência entre modo de combate e narrativo. Ingestão de documento (Plano 5) é a única peça restante do MVP.

**Placeholders:** nenhum — todo código é completo; o Step 5 da Task 6 é deliberadamente manual (requer sessão real no Discord com o Claude), mas cada verificação é concreta.

**Consistência de tipos:** `CombatCombatant`, `StoredCombatState` são definidos uma vez em `combat-repo.ts` e reutilizados sem renomear em `combat-tools.ts`, `iniciar-combate.ts` e `message-handler.ts`. `ToolContext.combat` é opcional, preservando compatibilidade com as tools do Plano 3. `resolverAtaqueTool`, `aplicarDanoTool`, `avancarTurnoTool` usam os mesmos nomes em todos os arquivos que os consomem.
