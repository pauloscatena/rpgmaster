# Laço Narrativo (fora de combate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar o Claude como "cérebro" do mestre para cenas fora de combate: o jogador escreve livremente no canal, o Claude narra e chama a ferramenta `fazer_teste` sempre que a ação exigir resolução mecânica — nunca inventando um resultado.

**Architecture:** Um orquestrador genérico (`runGameMasterTurn`) implementa o laço de tool-calling da Anthropic SDK contra uma lista de `ToolDefinition` (nome, schema JSON, função de execução). As tools desta fase (`fazer_teste`, `consultar_ficha`) chamam diretamente o motor de regras do Plano 1. O handler de mensagens do Discord monta o contexto (lore + resumo da sessão + ficha do personagem) e injeta como system prompt. O orquestrador é agnóstico às tools específicas — o Plano 4 (combate) só precisa adicionar novas `ToolDefinition`s a essa mesma lista, sem tocar no laço.

**Tech Stack:** `@anthropic-ai/sdk`, Node.js 20+, TypeScript, Vitest.

## Global Constraints

- Depende dos Planos 1 (motor de regras) e 2 (bot + persistência) já implementados.
- O LLM nunca calcula números de jogo diretamente — toda mecânica passa pela tool `fazer_teste`, que chama `fazerTeste` do motor de regras (Plano 1).
- Toda chamada de tool malformada ou com ferramenta desconhecida é tratada como erro (`is_error: true` no `tool_result`) e devolvida ao modelo, nunca aplicada como mutação de estado.
- O modelo usado é `claude-sonnet-5`.
- O laço de tool-calling tem um limite máximo de iterações (`MAX_TOOL_ITERATIONS = 6`) para nunca rodar indefinidamente.

---

## Estrutura de arquivos

```
RPGMaster/
  src/
    config.ts                 # MODIFICADO: adiciona anthropicApiKey
    db/
      campaigns-repo.ts        # MODIFICADO: adiciona updateSessionSummary
    llm/
      claude-client.ts
      tools.ts
      context.ts
      session-summary.ts
      orchestrator.ts
    bot/
      message-handler.ts
    index.ts                   # MODIFICADO: registra o listener de mensagens
  tests/
    config.test.ts             # MODIFICADO: cobre anthropicApiKey
    db/
      campaigns-repo.test.ts   # MODIFICADO: cobre updateSessionSummary
    llm/
      claude-client.test.ts
      tools.test.ts
      context.test.ts
      session-summary.test.ts
      orchestrator.test.ts
    bot/
      message-handler.test.ts
```

---

### Task 1: Cliente Claude e `ANTHROPIC_API_KEY` na configuração

**Files:**
- Create: `src/llm/claude-client.ts`
- Modify: `src/config.ts` (Plano 2, Task 4) — adicionar `anthropicApiKey`
- Test: `tests/llm/claude-client.test.ts`
- Modify: `tests/config.test.ts` (Plano 2, Task 4) — cobrir o novo campo

**Interfaces:**
- Consumes: nada de planos anteriores além da estrutura de `Config`.
- Produces: `function createClaudeClient(apiKey: string): Anthropic`; `Config` passa a incluir `anthropicApiKey: string`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/claude-client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createClaudeClient } from '../../src/llm/claude-client';

describe('createClaudeClient', () => {
  it('cria uma instância do cliente Anthropic', () => {
    const client = createClaudeClient('fake-api-key');
    expect(client).toBeInstanceOf(Anthropic);
  });
});
```

Atualizar `tests/config.test.ts` (arquivo completo, substituindo o do Plano 2):
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const validEnv = {
    DISCORD_TOKEN: 'token-a',
    DISCORD_CLIENT_ID: 'client-b',
    DATABASE_URL: 'postgres://c',
    ANTHROPIC_API_KEY: 'sk-ant-d',
  };

  it('carrega uma config válida a partir do ambiente', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      discordToken: 'token-a',
      discordClientId: 'client-b',
      databaseUrl: 'postgres://c',
      anthropicApiKey: 'sk-ant-d',
    });
  });

  it('lança erro quando falta DISCORD_TOKEN', () => {
    const { DISCORD_TOKEN, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/);
  });

  it('lança erro quando falta DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('lança erro quando falta ANTHROPIC_API_KEY', () => {
    const { ANTHROPIC_API_KEY, ...rest } = validEnv;
    expect(() => loadConfig(rest)).toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/claude-client.test.ts tests/config.test.ts`
Expected: FAIL — `src/llm/claude-client.ts` não existe e o teste de `ANTHROPIC_API_KEY` falha contra o `loadConfig` atual.

- [ ] **Step 3: Implementar**

`src/llm/claude-client.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
```

Substituir `src/config.ts` inteiro por:
```ts
export interface Config {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
  anthropicApiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordToken = env.DISCORD_TOKEN;
  const discordClientId = env.DISCORD_CLIENT_ID;
  const databaseUrl = env.DATABASE_URL;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!discordToken) throw new Error('DISCORD_TOKEN não definido');
  if (!discordClientId) throw new Error('DISCORD_CLIENT_ID não definido');
  if (!databaseUrl) throw new Error('DATABASE_URL não definido');
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY não definido');
  return { discordToken, discordClientId, databaseUrl, anthropicApiKey };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/claude-client.test.ts tests/config.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/claude-client.ts src/config.ts tests/llm/claude-client.test.ts tests/config.test.ts
git commit -m "feat: add claude client and anthropic api key config"
```

---

### Task 2: Tools `fazer_teste` e `consultar_ficha`

**Files:**
- Create: `src/llm/tools.ts`
- Test: `tests/llm/tools.test.ts`

**Interfaces:**
- Consumes: `fazerTeste`, `RulesetConfig`, `CharacterSheet`, `Rng` de `src/rules-engine` (Plano 1); `StoredCharacter` de `src/db/characters-repo.ts` (Plano 2, só para tipar `ToolContext.actingCharacter`).
- Produces: `interface ToolContext { config: RulesetConfig; actingCharacter: StoredCharacter; rng: Rng }`; `interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; execute: (input: unknown, ctx: ToolContext) => Promise<unknown> }`; `const fazerTesteTool: ToolDefinition`; `const consultarFichaTool: ToolDefinition`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fazerTesteTool, consultarFichaTool, type ToolContext } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

describe('fazerTesteTool', () => {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  const ctx: ToolContext = { config, actingCharacter, rng: () => 0.5 };

  it('tem nome e schema de entrada corretos', () => {
    expect(fazerTesteTool.name).toBe('fazer_teste');
    expect(fazerTesteTool.inputSchema).toMatchObject({
      type: 'object',
      required: ['attribute', 'difficulty'],
    });
  });

  it('executa fazerTeste do motor de regras e devolve o resultado', async () => {
    const result = (await fazerTesteTool.execute({ attribute: 'forca', difficulty: 10 }, ctx)) as {
      total: number;
      success: boolean;
    };
    expect(result.total).toBe(14); // d20 rng=0.5 -> 11 + forca 3
    expect(result.success).toBe(true);
  });
});

describe('consultarFichaTool', () => {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  const ctx: ToolContext = { config, actingCharacter, rng: () => 0.5 };

  it('tem nome correto', () => {
    expect(consultarFichaTool.name).toBe('consultar_ficha');
  });

  it('devolve a ficha do personagem que está agindo', async () => {
    const result = await consultarFichaTool.execute({}, ctx);
    expect(result).toEqual(sheet);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/tools.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `tools.ts`**

`src/llm/tools.ts`:
```ts
import { fazerTeste, type CharacterSheet, type Rng, type RulesetConfig } from '../rules-engine';
import type { StoredCharacter } from '../db/characters-repo';

export interface ToolContext {
  config: RulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

export const fazerTesteTool: ToolDefinition = {
  name: 'fazer_teste',
  description:
    'Resolve um teste de atributo rolando o dado configurado para a campanha. Use sempre que uma ação do jogador tiver resultado incerto (ex: percepção, persuasão, escalar um muro). Nunca invente o resultado de um teste — sempre chame esta ferramenta.',
  inputSchema: {
    type: 'object',
    properties: {
      attribute: {
        type: 'string',
        description: 'Nome do atributo a ser testado (deve ser um dos atributos da ficha do personagem).',
      },
      difficulty: {
        type: 'number',
        description: 'Dificuldade do teste (número que o resultado precisa igualar ou superar).',
      },
    },
    required: ['attribute', 'difficulty'],
  },
  execute: async (input, ctx) => {
    const { attribute, difficulty } = input as { attribute: string; difficulty: number };
    return fazerTeste(ctx.config, ctx.actingCharacter.sheet, attribute, difficulty, ctx.rng);
  },
};

export const consultarFichaTool: ToolDefinition = {
  name: 'consultar_ficha',
  description: 'Consulta a ficha completa (atributos, recursos e inventário) do personagem que está agindo.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async (_input, ctx): Promise<CharacterSheet> => {
    return ctx.actingCharacter.sheet;
  },
};
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/tools.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/tools.ts tests/llm/tools.test.ts
git commit -m "feat: add fazer_teste and consultar_ficha tools"
```

---

### Task 3: Orquestrador do laço de tool-calling

**Files:**
- Create: `src/llm/orchestrator.ts`
- Test: `tests/llm/orchestrator.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`, `ToolContext` de `src/llm/tools.ts` (Task 2); tipos de `@anthropic-ai/sdk`.
- Produces: `interface GameMasterTurnResult { narration: string; toolCalls: { name: string; input: unknown; result: unknown }[] }`; `async function runGameMasterTurn(client: Anthropic, systemPrompt: string, userMessage: string, tools: ToolDefinition[], toolContext: ToolContext): Promise<GameMasterTurnResult>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/orchestrator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runGameMasterTurn } from '../../src/llm/orchestrator';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

function makeToolContext(): ToolContext {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  return { config, actingCharacter, rng: () => 0.5 };
}

function makeFakeClient(responses: unknown[]): Anthropic {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  return { messages: { create } } as unknown as Anthropic;
}

describe('runGameMasterTurn', () => {
  it('devolve a narração direto quando não há chamada de ferramenta', async () => {
    const client = makeFakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Você entra na sala escura.' }] },
    ]);
    const result = await runGameMasterTurn(client, 'system', 'eu entro na sala', [], makeToolContext());
    expect(result.narration).toBe('Você entra na sala escura.');
    expect(result.toolCalls).toEqual([]);
  });

  it('executa a ferramenta chamada e usa o resultado na resposta seguinte', async () => {
    const testTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ total: 14, success: true }),
    };
    const client = makeFakeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Você consegue escalar o muro!' }] },
    ]);
    const result = await runGameMasterTurn(client, 'system', 'eu escalo o muro', [testTool], makeToolContext());
    expect(testTool.execute).toHaveBeenCalledWith({ attribute: 'forca', difficulty: 10 }, expect.anything());
    expect(result.narration).toBe('Você consegue escalar o muro!');
    expect(result.toolCalls).toEqual([
      { name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 }, result: { total: 14, success: true } },
    ]);
  });

  it('envia tool_result com is_error quando a ferramenta é desconhecida', async () => {
    const client = makeFakeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'ferramenta_inexistente', input: {} }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] },
    ]);
    const result = await runGameMasterTurn(client, 'system', 'oi', [], makeToolContext());
    expect(result.narration).toBe('Ok.');
    const secondCallArgs = (client.messages.create as any).mock.calls[1][0];
    const toolResultMessage = secondCallArgs.messages.at(-1);
    expect(toolResultMessage.content[0].is_error).toBe(true);
  });

  it('lança erro ao exceder o número máximo de iterações', async () => {
    const infiniteTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({}),
    };
    const alwaysToolUse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'fazer_teste', input: {} }],
    };
    const client = makeFakeClient(Array(10).fill(alwaysToolUse));
    await expect(
      runGameMasterTurn(client, 'system', 'oi', [infiniteTool], makeToolContext())
    ).rejects.toThrow(/máximo/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/orchestrator.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `orchestrator.ts`**

`src/llm/orchestrator.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { ToolContext, ToolDefinition } from './tools';

export interface GameMasterTurnResult {
  narration: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
}

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 6;

export async function runGameMasterTurn(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  tools: ToolDefinition[],
  toolContext: ToolContext
): Promise<GameMasterTurnResult> {
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
  const toolCalls: GameMasterTurnResult['toolCalls'] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    });

    if (response.stop_reason !== 'tool_use') {
      const narration = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      return { narration, toolCalls };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const tool = tools.find((t) => t.name === block.name);
      if (!tool) {
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Ferramenta desconhecida: ${block.name}` }),
          is_error: true,
        });
        continue;
      }
      try {
        const result = await tool.execute(block.input, toolContext);
        toolCalls.push({ name: block.name, input: block.input, result });
        toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      } catch (err) {
        toolResultContent.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ error: (err as Error).message }),
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResultContent });
  }

  throw new Error('Número máximo de chamadas de ferramenta excedido nesta rodada.');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/orchestrator.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/orchestrator.ts tests/llm/orchestrator.test.ts
git commit -m "feat: add tool-calling orchestrator for the game master loop"
```

---

### Task 4: Construção do system prompt (contexto)

**Files:**
- Create: `src/llm/context.ts`
- Test: `tests/llm/context.test.ts`

**Interfaces:**
- Consumes: nenhuma dependência de código de planos anteriores (só strings).
- Produces: `function buildSystemPrompt(params: { campaignName: string; lore: string; sessionSummary: string; rulesetName: string }): string`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/context.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/llm/context';

describe('buildSystemPrompt', () => {
  it('inclui o nome da campanha e do sistema de regras', () => {
    const prompt = buildSystemPrompt({
      campaignName: 'A Torre Esquecida',
      lore: 'Uma torre antiga no meio da floresta.',
      sessionSummary: '',
      rulesetName: 'Sistema Simplificado Padrão',
    });
    expect(prompt).toContain('A Torre Esquecida');
    expect(prompt).toContain('Sistema Simplificado Padrão');
    expect(prompt).toContain('Uma torre antiga no meio da floresta.');
  });

  it('instrui o modelo a nunca inventar resultados de teste', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y' });
    expect(prompt).toMatch(/nunca invente/i);
  });

  it('usa um texto padrão quando lore e resumo estão vazios', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y' });
    expect(prompt).toContain('nenhuma lore registrada ainda');
    expect(prompt).toContain('primeira interação da campanha');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/context.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `context.ts`**

`src/llm/context.ts`:
```ts
export function buildSystemPrompt(params: {
  campaignName: string;
  lore: string;
  sessionSummary: string;
  rulesetName: string;
}): string {
  return [
    `Você é o mestre de um RPG de mesa chamado "${params.campaignName}", usando o sistema de regras "${params.rulesetName}".`,
    'Narre a aventura de forma envolvente e consistente com o histórico da campanha.',
    'Sempre que uma ação do jogador tiver resultado incerto, use a ferramenta fazer_teste em vez de inventar um resultado.',
    'Nunca invente valores de atributos, recursos ou resultados de dado — sempre use as ferramentas disponíveis para isso.',
    '',
    'Cenário e história até agora:',
    params.lore || '(nenhuma lore registrada ainda)',
    '',
    'Resumo da sessão até o momento:',
    params.sessionSummary || '(esta é a primeira interação da campanha)',
  ].join('\n');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/context.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/context.ts tests/llm/context.test.ts
git commit -m "feat: add system prompt builder"
```

---

### Task 5: Resumo de sessão + persistência

**Files:**
- Create: `src/llm/session-summary.ts`
- Modify: `src/db/campaigns-repo.ts` (Plano 2, Task 2) — adicionar `updateSessionSummary`
- Test: `tests/llm/session-summary.test.ts`
- Modify: `tests/db/campaigns-repo.test.ts` (Plano 2, Task 2) — cobrir `updateSessionSummary`

**Interfaces:**
- Consumes: `Campaign` de `src/db/campaigns-repo.ts`.
- Produces: `function appendToSessionSummary(current: string, exchange: string, maxLength?: number): string`; `async function updateSessionSummary(pool: Pool, campaignId: string, sessionSummary: string): Promise<void>` (adicionada a `campaigns-repo.ts`).

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/session-summary.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { appendToSessionSummary } from '../../src/llm/session-summary';

describe('appendToSessionSummary', () => {
  it('concatena o resumo atual com o novo trecho', () => {
    const result = appendToSessionSummary('Início da aventura.', 'Aria: eu entro na sala.');
    expect(result).toBe('Início da aventura.\nAria: eu entro na sala.');
  });

  it('usa o novo trecho sozinho quando o resumo atual está vazio', () => {
    const result = appendToSessionSummary('', 'Aria: eu entro na sala.');
    expect(result).toBe('Aria: eu entro na sala.');
  });

  it('trunca mantendo apenas o final quando excede o tamanho máximo', () => {
    const current = 'a'.repeat(20);
    const result = appendToSessionSummary(current, 'b'.repeat(10), 15);
    expect(result.length).toBe(15);
    expect(result.endsWith('b'.repeat(10))).toBe(true);
  });
});
```

Adicionar ao final de `tests/db/campaigns-repo.test.ts` (dentro do `describe('campaigns-repo', ...)` existente):
```ts
  it('atualiza o resumo da sessão de uma campanha', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    await updateSessionSummary(pool, campaign.id, 'Aria entrou na torre.');
    const updated = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(updated?.sessionSummary).toBe('Aria entrou na torre.');
  });
```

E adicionar `updateSessionSummary` ao import existente de `../../src/db/campaigns-repo` no topo do arquivo de teste.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/session-summary.test.ts tests/db/campaigns-repo.test.ts`
Expected: FAIL — `session-summary.ts` não existe e `updateSessionSummary` não é exportado por `campaigns-repo.ts`.

- [ ] **Step 3: Implementar**

`src/llm/session-summary.ts`:
```ts
export function appendToSessionSummary(current: string, exchange: string, maxLength = 4000): string {
  const combined = current ? `${current}\n${exchange}` : exchange;
  if (combined.length <= maxLength) return combined;
  return combined.slice(combined.length - maxLength);
}
```

Adicionar ao final de `src/db/campaigns-repo.ts` (depois de `getCampaignByChannel`):
```ts
export async function updateSessionSummary(pool: Pool, campaignId: string, sessionSummary: string): Promise<void> {
  await pool.query(`UPDATE campaigns SET session_summary = $2 WHERE id = $1`, [campaignId, sessionSummary]);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/session-summary.test.ts tests/db/campaigns-repo.test.ts`
Expected: PASS (3 + 5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/session-summary.ts src/db/campaigns-repo.ts tests/llm/session-summary.test.ts tests/db/campaigns-repo.test.ts
git commit -m "feat: add session summary tracking"
```

---

### Task 6: Handler de mensagens do Discord

**Files:**
- Create: `src/bot/message-handler.ts`
- Test: `tests/bot/message-handler.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `updateSessionSummary` de `src/db/campaigns-repo.ts` (Plano 2, Task 5); `getCharacterByPlayer` de `src/db/characters-repo.ts` (Plano 2, Task 3); `runGameMasterTurn` de `src/llm/orchestrator.ts` (Task 3); `fazerTesteTool`, `consultarFichaTool` de `src/llm/tools.ts` (Task 2); `buildSystemPrompt` de `src/llm/context.ts` (Task 4); `appendToSessionSummary` de `src/llm/session-summary.ts` (Task 5).
- Produces: `async function handleMessage(message: Message, pool: Pool, claudeClient: Anthropic): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/message-handler.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import * as orchestrator from '../../src/llm/orchestrator';

describe('handleMessage', () => {
  let pool: Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(async () => {
    vi.restoreAllMocks();
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    await createCharacter(pool, {
      campaignId: campaign!.id,
      playerDiscordId: 'player-1',
      sheet: { name: 'Aria', attributes: { forca: 3, destreza: 2, intelecto: 1 }, resources: { hp: 13 }, inventory: [] },
    });
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

  it('ignora mensagens em canais sem campanha ativa', async () => {
    const spy = vi.spyOn(orchestrator, 'runGameMasterTurn');
    const message = makeMessage('oi');
    message.channelId = 'channel-sem-campanha';
    await handleMessage(message, pool, claudeClient);
    expect(spy).not.toHaveBeenCalled();
  });

  it('pede para criar personagem quando o autor não tem ficha na campanha', async () => {
    const message = makeMessage('eu examino a sala', 'player-sem-ficha');
    await handleMessage(message, pool, claudeClient);
    expect(message._replies[0]).toMatch(/criar-personagem/);
  });

  it('chama o orquestrador e responde com a narração', async () => {
    vi.spyOn(orchestrator, 'runGameMasterTurn').mockResolvedValue({
      narration: 'Você vê uma sala empoeirada.',
      toolCalls: [],
    });
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, claudeClient);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('atualiza o resumo da sessão após a resposta', async () => {
    vi.spyOn(orchestrator, 'runGameMasterTurn').mockResolvedValue({
      narration: 'Você vê uma sala empoeirada.',
      toolCalls: [],
    });
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, claudeClient);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.sessionSummary).toContain('sala empoeirada');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/message-handler.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `message-handler.ts`**

`src/bot/message-handler.ts`:
```ts
import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel, updateSessionSummary } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import * as orchestrator from '../llm/orchestrator';
import { fazerTesteTool, consultarFichaTool } from '../llm/tools';
import { buildSystemPrompt } from '../llm/context';
import { appendToSessionSummary } from '../llm/session-summary';

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

  const systemPrompt = buildSystemPrompt({
    campaignName: campaign.name,
    lore: campaign.lore,
    sessionSummary: campaign.sessionSummary,
    rulesetName: campaign.rulesetConfig.name,
  });

  const result = await orchestrator.runGameMasterTurn(
    claudeClient,
    systemPrompt,
    message.content,
    [fazerTesteTool, consultarFichaTool],
    { config: campaign.rulesetConfig, actingCharacter: character, rng: Math.random }
  );

  await message.reply(result.narration);

  const exchange = `${character.sheet.name}: ${message.content}\nMestre: ${result.narration}`;
  const updatedSummary = appendToSessionSummary(campaign.sessionSummary, exchange);
  await updateSessionSummary(pool, campaign.id, updatedSummary);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/message-handler.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/message-handler.ts tests/bot/message-handler.test.ts
git commit -m "feat: add narrative message handler wired to the claude tool-calling loop"
```

---

### Task 7: Wiring final e smoke test manual

**Files:**
- Modify: `src/index.ts` (Plano 2, Task 8) — registrar o listener `messageCreate` e criar o cliente Claude

**Interfaces:**
- Consumes: `createClaudeClient` (Task 1); `handleMessage` (Task 6); `loadConfig`, `createPool`, `createDiscordClient`, `routeInteraction` (Plano 2).

- [ ] **Step 1: Substituir `src/index.ts` inteiro**

`src/index.ts`:
```ts
import 'dotenv/config';
import { createPool } from './db/pool';
import { createDiscordClient } from './bot/client';
import { routeInteraction } from './bot/interaction-router';
import { handleMessage } from './bot/message-handler';
import { createClaudeClient } from './llm/claude-client';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = createDiscordClient();
  const claudeClient = createClaudeClient(config.anthropicApiKey);

  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool).catch((err) => {
      console.error('Erro ao processar interação:', err);
    });
  });

  client.on('messageCreate', (message) => {
    handleMessage(message, pool, claudeClient).catch((err) => {
      console.error('Erro ao processar mensagem:', err);
    });
  });

  client.once('ready', () => {
    console.log(`Bot conectado como ${client.user?.tag}`);
  });

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar a suíte inteira e o type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em todos os testes (Planos 1-3), sem erros de tipo.

- [ ] **Step 3: Smoke test manual (requer `ANTHROPIC_API_KEY` real)**

1. Preencher `ANTHROPIC_API_KEY` no `.env` com uma chave válida da Anthropic.
2. Rodar `npm run dev` e, no servidor de teste (já configurado no Plano 2), rodar `/criar-campanha` e `/criar-personagem` se ainda não existirem.
3. Escrever no canal da campanha uma ação livre, ex: "eu examino a sala em busca de armadilhas" — confirmar que o bot responde com uma narração coerente.
4. Escrever uma ação que exija teste, ex: "eu tento escalar o muro da torre" — confirmar (via log do console, se necessário) que a ferramenta `fazer_teste` foi chamada e que a narração reflete o resultado (sucesso ou falha) de forma consistente.
5. Escrever uma segunda mensagem na sequência e confirmar que a narração faz referência ao que aconteceu antes (resumo de sessão funcionando).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire claude-powered narrative loop into the bot entry point"
```

---

## Self-Review

**Cobertura da spec:** cobre o fluxo "fora de combate" do design — Claude narra, chama `fazer_teste` quando necessário, nunca inventa números, e a continuidade entre mensagens é mantida via resumo de sessão persistido em `campaigns.session_summary`. Combate por turnos (Plano 4) e ingestão de documento (Plano 5) ficam para os próximos planos.

**Placeholders:** nenhum — todo código é completo; o Step 3 da Task 7 é deliberadamente manual (requer uma chave de API real da Anthropic), mas cada verificação é concreta.

**Consistência de tipos:** `ToolContext`, `ToolDefinition`, `GameMasterTurnResult` são definidos uma vez (Tasks 2 e 3) e reutilizados sem renomear em `message-handler.ts` e nos testes. `Config` ganha `anthropicApiKey` de forma consistente entre `config.ts`, `index.ts` e os testes.
