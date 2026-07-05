# Laço Narrativo (fora de combate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar um LLM como "cérebro" do mestre para cenas fora de combate — o jogador escreve livremente no canal, o modelo narra e chama a ferramenta `fazer_teste` sempre que a ação exigir resolução mecânica — sem depender de um único provedor: o mesmo laço de jogo funciona tanto com Claude (nuvem) quanto com um modelo local via Ollama (offline).

**Architecture:** Um orquestrador genérico (`runGameMasterTurn`, do plano anterior) vira uma interface `LlmProvider` com um único método `runTurn`. Duas implementações a satisfazem: `ClaudeProvider` (Anthropic SDK, tool use nativo) e `OllamaProvider` (API compatível com OpenAI que o Ollama expõe, com `tools`/`tool_calls` no formato de function calling da OpenAI). Uma fábrica (`createLlmProvider`) escolhe a implementação a partir da configuração (`LLM_PROVIDER=claude|ollama`). O resto do sistema (handler de mensagens, tools do motor de regras) depende só da interface `LlmProvider`, nunca de um SDK específico — trocar de provedor não exige tocar em mais nada. A ingestão de documento de campanha (Plano 5) continua usando o Claude diretamente, independente da escolha aqui — é uma operação única, de alto risco se malfeita, e se beneficia do provedor mais confiável disponível; por isso `ANTHROPIC_API_KEY` continua obrigatória mesmo quando o laço narrativo usa Ollama.

**Tech Stack:** `@anthropic-ai/sdk`, `openai` (cliente usado contra o endpoint compatível do Ollama), Node.js 20+, TypeScript, Vitest.

## Global Constraints

- Depende dos Planos 1 (motor de regras) e 2 (bot + persistência) já implementados.
- O LLM nunca calcula números de jogo diretamente — toda mecânica passa pela tool `fazer_teste`, que chama `fazerTeste` do motor de regras (Plano 1).
- Toda chamada de tool malformada ou com ferramenta desconhecida é tratada como erro e devolvida ao modelo, nunca aplicada como mutação de estado.
- O laço de jogo (handler de mensagens, tools) depende exclusivamente da interface `LlmProvider` — nunca importa `Anthropic` ou `OpenAI` diretamente fora dos arquivos `*-provider.ts`.
- `ANTHROPIC_API_KEY` é sempre obrigatória, mesmo quando `LLM_PROVIDER=ollama`, porque a ingestão de documento de campanha (Plano 5) sempre usa Claude, independente do provedor do laço narrativo.
- O laço de tool-calling (em qualquer provedor) tem um limite máximo de iterações (`MAX_TOOL_ITERATIONS = 6`) para nunca rodar indefinidamente.
- O modelo Claude usado é `claude-sonnet-5`.

---

## Estrutura de arquivos

```
RPGMaster/
  .env.example                # MODIFICADO: LLM_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL
  src/
    config.ts                 # MODIFICADO: Config vira união discriminada por llmProvider
    db/
      campaigns-repo.ts        # MODIFICADO: adiciona updateSessionSummary
    llm/
      provider.ts              # interface LlmProvider, GameMasterTurnResult
      claude-client.ts
      claude-provider.ts        # implementa LlmProvider com a Anthropic SDK
      ollama-provider.ts        # implementa LlmProvider com o endpoint compatível do Ollama
      create-provider.ts        # fábrica: escolhe a implementação a partir da Config
      tools.ts
      context.ts
      session-summary.ts
    bot/
      message-handler.ts        # depende de LlmProvider, não de um SDK específico
    index.ts                    # MODIFICADO: registra o listener de mensagens
  tests/
    config.test.ts              # MODIFICADO: cobre llmProvider/ollama
    db/
      campaigns-repo.test.ts    # MODIFICADO
    llm/
      claude-client.test.ts
      claude-provider.test.ts
      ollama-provider.test.ts
      create-provider.test.ts
      tools.test.ts
      context.test.ts
      session-summary.test.ts
    bot/
      message-handler.test.ts
```

---

### Task 1: Interface `LlmProvider` e configuração multi-provedor

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/claude-client.ts`
- Modify: `src/config.ts` (Plano 2, Task 4) — `Config` vira união discriminada por `llmProvider`
- Modify: `.env.example` (Plano 2, Task 4)
- Test: `tests/llm/claude-client.test.ts`
- Modify: `tests/config.test.ts` (Plano 2, Task 4)

**Interfaces:**
- Produces: `interface GameMasterTurnResult { narration: string; toolCalls: { name: string; input: unknown; result: unknown }[] }`; `interface LlmProvider { runTurn(systemPrompt: string, userMessage: string, tools: ToolDefinition[], toolContext: ToolContext): Promise<GameMasterTurnResult> }`; `function createClaudeClient(apiKey: string): Anthropic`; `Config` passa a ser `{ discordToken, discordClientId, databaseUrl, anthropicApiKey } & ({ llmProvider: 'claude' } | { llmProvider: 'ollama'; ollamaBaseUrl: string; ollamaModel: string })`.

- [ ] **Step 1: Adicionar a dependência `openai` (usada no Task 4 deste plano) e escrever os testes falhos**

Adicionar em `dependencies` no `package.json`: `"openai": "^4.68.4"`.

Run: `npm install openai`

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

Substituir `tests/config.test.ts` inteiro por:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const claudeEnv = {
    DISCORD_TOKEN: 'token-a',
    DISCORD_CLIENT_ID: 'client-b',
    DATABASE_URL: 'postgres://c',
    ANTHROPIC_API_KEY: 'sk-ant-d',
  };

  it('usa claude por padrão quando LLM_PROVIDER não é definido', () => {
    const config = loadConfig(claudeEnv);
    expect(config).toEqual({
      discordToken: 'token-a',
      discordClientId: 'client-b',
      databaseUrl: 'postgres://c',
      anthropicApiKey: 'sk-ant-d',
      llmProvider: 'claude',
    });
  });

  it('lança erro quando falta DISCORD_TOKEN', () => {
    const { DISCORD_TOKEN, ...rest } = claudeEnv;
    expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/);
  });

  it('lança erro quando falta DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = claudeEnv;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('lança erro quando falta ANTHROPIC_API_KEY mesmo com LLM_PROVIDER=ollama', () => {
    const { ANTHROPIC_API_KEY, ...rest } = claudeEnv;
    expect(() =>
      loadConfig({ ...rest, LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_MODEL: 'qwen2.5' })
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('lança erro quando LLM_PROVIDER é um valor desconhecido', () => {
    expect(() => loadConfig({ ...claudeEnv, LLM_PROVIDER: 'gpt-mágico' })).toThrow(/LLM_PROVIDER inválido/);
  });

  it('carrega config de ollama quando LLM_PROVIDER=ollama e as variáveis de ollama estão presentes', () => {
    const config = loadConfig({
      ...claudeEnv,
      LLM_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'qwen2.5',
    });
    expect(config).toEqual({
      discordToken: 'token-a',
      discordClientId: 'client-b',
      databaseUrl: 'postgres://c',
      anthropicApiKey: 'sk-ant-d',
      llmProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5',
    });
  });

  it('lança erro quando LLM_PROVIDER=ollama mas falta OLLAMA_BASE_URL', () => {
    expect(() =>
      loadConfig({ ...claudeEnv, LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2.5' })
    ).toThrow(/OLLAMA_BASE_URL/);
  });

  it('lança erro quando LLM_PROVIDER=ollama mas falta OLLAMA_MODEL', () => {
    expect(() =>
      loadConfig({ ...claudeEnv, LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://localhost:11434' })
    ).toThrow(/OLLAMA_MODEL/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/claude-client.test.ts tests/config.test.ts`
Expected: FAIL — `src/llm/claude-client.ts` não existe e `loadConfig` ainda não suporta `llmProvider`.

- [ ] **Step 3: Implementar**

`src/llm/provider.ts`:
```ts
import type { ToolContext, ToolDefinition } from './tools';

export interface GameMasterTurnResult {
  narration: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
}

export interface LlmProvider {
  runTurn(
    systemPrompt: string,
    userMessage: string,
    tools: ToolDefinition[],
    toolContext: ToolContext
  ): Promise<GameMasterTurnResult>;
}
```

`src/llm/claude-client.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
```

Substituir `src/config.ts` inteiro por:
```ts
interface BaseConfig {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
  anthropicApiKey: string;
}

export type Config =
  | (BaseConfig & { llmProvider: 'claude' })
  | (BaseConfig & { llmProvider: 'ollama'; ollamaBaseUrl: string; ollamaModel: string });

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordToken = env.DISCORD_TOKEN;
  const discordClientId = env.DISCORD_CLIENT_ID;
  const databaseUrl = env.DATABASE_URL;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!discordToken) throw new Error('DISCORD_TOKEN não definido');
  if (!discordClientId) throw new Error('DISCORD_CLIENT_ID não definido');
  if (!databaseUrl) throw new Error('DATABASE_URL não definido');
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY não definido (necessário mesmo com LLM_PROVIDER=ollama, usado na ingestão de documentos)');
  }

  const llmProviderRaw = env.LLM_PROVIDER ?? 'claude';
  if (llmProviderRaw !== 'claude' && llmProviderRaw !== 'ollama') {
    throw new Error(`LLM_PROVIDER inválido: "${llmProviderRaw}" (use "claude" ou "ollama")`);
  }

  if (llmProviderRaw === 'ollama') {
    const ollamaBaseUrl = env.OLLAMA_BASE_URL;
    const ollamaModel = env.OLLAMA_MODEL;
    if (!ollamaBaseUrl) throw new Error('OLLAMA_BASE_URL não definido (necessário quando LLM_PROVIDER=ollama)');
    if (!ollamaModel) throw new Error('OLLAMA_MODEL não definido (necessário quando LLM_PROVIDER=ollama)');
    return { discordToken, discordClientId, databaseUrl, anthropicApiKey, llmProvider: 'ollama', ollamaBaseUrl, ollamaModel };
  }

  return { discordToken, discordClientId, databaseUrl, anthropicApiKey, llmProvider: 'claude' };
}
```

Adicionar ao `.env.example` (mantendo as linhas já existentes do Plano 2):
```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DATABASE_URL=postgres://user:password@localhost:5432/rpgmaster
ANTHROPIC_API_KEY=
LLM_PROVIDER=claude
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/claude-client.test.ts tests/config.test.ts`
Expected: PASS (1 + 8 testes).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/llm/provider.ts src/llm/claude-client.ts src/config.ts .env.example tests/llm/claude-client.test.ts tests/config.test.ts
git commit -m "feat: add LlmProvider interface and multi-provider configuration"
```

---

### Task 2: Tools `fazer_teste` e `consultar_ficha`

**Files:**
- Create: `src/llm/tools.ts`
- Test: `tests/llm/tools.test.ts`

**Interfaces:**
- Consumes: `fazerTeste`, `ValidatedRulesetConfig`, `CharacterSheet`, `Rng` de `src/rules-engine` (Plano 1); `StoredCharacter` de `src/db/characters-repo.ts` (Plano 2, só para tipar `ToolContext.actingCharacter`).
- Produces: `interface ToolContext { config: ValidatedRulesetConfig; actingCharacter: StoredCharacter; rng: Rng }`; `interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown>; execute: (input: unknown, ctx: ToolContext) => Promise<unknown> }`; `const fazerTesteTool: ToolDefinition`; `const consultarFichaTool: ToolDefinition`.

Nota: `ToolContext.config` usa `ValidatedRulesetConfig` (Plano 1) porque `fazerTesteTool.execute` chama `fazerTeste(ctx.config, ...)`, que exige esse tipo desde o fix da revisão final do Plano 1. `campaign.rulesetConfig` (Plano 2) já é `ValidatedRulesetConfig`, então montar o `ToolContext` a partir dele não exige nenhum cast.

Esta task é idêntica à do plano original (independe do provedor de LLM escolhido).

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
import { fazerTeste, type CharacterSheet, type Rng, type ValidatedRulesetConfig } from '../rules-engine';
import type { StoredCharacter } from '../db/characters-repo';

export interface ToolContext {
  config: ValidatedRulesetConfig;
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

### Task 3: `ClaudeProvider`

**Files:**
- Create: `src/llm/claude-provider.ts`
- Test: `tests/llm/claude-provider.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `GameMasterTurnResult` de `src/llm/provider.ts` (Task 1); `ToolDefinition`, `ToolContext` de `src/llm/tools.ts` (Task 2); tipos de `@anthropic-ai/sdk`.
- Produces: `function createClaudeProvider(client: Anthropic, model?: string): LlmProvider`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/claude-provider.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeProvider } from '../../src/llm/claude-provider';
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

describe('createClaudeProvider().runTurn', () => {
  it('devolve a narração direto quando não há chamada de ferramenta', async () => {
    const client = makeFakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Você entra na sala escura.' }] },
    ]);
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'eu entro na sala', [], makeToolContext());
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
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'eu escalo o muro', [testTool], makeToolContext());
    expect(testTool.execute).toHaveBeenCalledWith({ attribute: 'forca', difficulty: 10 }, expect.anything());
    expect(result.narration).toBe('Você consegue escalar o muro!');
    expect(result.toolCalls).toEqual([
      { name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 }, result: { total: 14, success: true } },
    ]);
  });

  it('envia tool_result com is_error quando a ferramenta é desconhecida', async () => {
    const client = makeFakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'ferramenta_inexistente', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] },
    ]);
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'oi', [], makeToolContext());
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
    const provider = createClaudeProvider(client);
    await expect(provider.runTurn('system', 'oi', [infiniteTool], makeToolContext())).rejects.toThrow(/máximo/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/claude-provider.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `claude-provider.ts`**

`src/llm/claude-provider.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { GameMasterTurnResult, LlmProvider } from './provider';
import type { ToolContext, ToolDefinition } from './tools';

const MAX_TOOL_ITERATIONS = 6;

export function createClaudeProvider(client: Anthropic, model = 'claude-sonnet-5'): LlmProvider {
  return {
    async runTurn(
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
          model,
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
    },
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/claude-provider.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/claude-provider.ts tests/llm/claude-provider.test.ts
git commit -m "feat: add ClaudeProvider implementing LlmProvider"
```

---

### Task 4: `OllamaProvider`

**Files:**
- Create: `src/llm/ollama-provider.ts`
- Test: `tests/llm/ollama-provider.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `GameMasterTurnResult` de `src/llm/provider.ts` (Task 1); `ToolDefinition`, `ToolContext` de `src/llm/tools.ts` (Task 2); tipos do pacote `openai`.
- Produces: `function createOllamaProvider(baseUrl: string, model: string): LlmProvider`.

O Ollama expõe um endpoint compatível com a API de chat da OpenAI (incluindo `tools`/`tool_calls` no formato de function calling), então usamos o SDK `openai` apontado para o servidor local em vez de reimplementar o protocolo HTTP.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/ollama-provider.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createOllamaProvider } from '../../src/llm/ollama-provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: vi.fn() } },
    })),
  };
});

function makeToolContext(): ToolContext {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  return { config, actingCharacter, rng: () => 0.5 };
}

describe('createOllamaProvider().runTurn', () => {
  it('devolve a narração direto quando não há tool_calls', async () => {
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results[0].value as OpenAI;
    (clientInstance.chat.completions.create as any).mockResolvedValueOnce({
      choices: [{ message: { content: 'Você entra na sala escura.', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'eu entro na sala', [], makeToolContext());
    expect(result.narration).toBe('Você entra na sala escura.');
    expect(result.toolCalls).toEqual([]);
  });

  it('executa a ferramenta chamada via tool_calls e usa o resultado na resposta seguinte', async () => {
    const testTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ total: 14, success: true }),
    };
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call-1', function: { name: 'fazer_teste', arguments: JSON.stringify({ attribute: 'forca', difficulty: 10 }) } },
            ],
          },
        },
      ],
    });
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Você consegue escalar o muro!', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'eu escalo o muro', [testTool], makeToolContext());
    expect(testTool.execute).toHaveBeenCalledWith({ attribute: 'forca', difficulty: 10 }, expect.anything());
    expect(result.narration).toBe('Você consegue escalar o muro!');
    expect(result.toolCalls).toEqual([
      { name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 }, result: { total: 14, success: true } },
    ]);
  });

  it('lança erro ao exceder o número máximo de iterações', async () => {
    const infiniteTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({}),
    };
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    const alwaysToolCall = {
      choices: [
        { message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'fazer_teste', arguments: '{}' } }] } },
      ],
    };
    for (let i = 0; i < 10; i++) create.mockResolvedValueOnce(alwaysToolCall);
    await expect(provider.runTurn('system', 'oi', [infiniteTool], makeToolContext())).rejects.toThrow(/máximo/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/ollama-provider.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `ollama-provider.ts`**

`src/llm/ollama-provider.ts`:
```ts
import OpenAI from 'openai';
import type { GameMasterTurnResult, LlmProvider } from './provider';
import type { ToolContext, ToolDefinition } from './tools';

const MAX_TOOL_ITERATIONS = 6;

export function createOllamaProvider(baseUrl: string, model: string): LlmProvider {
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: 'ollama' });

  return {
    async runTurn(
      systemPrompt: string,
      userMessage: string,
      tools: ToolDefinition[],
      toolContext: ToolContext
    ): Promise<GameMasterTurnResult> {
      const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];
      const toolCalls: GameMasterTurnResult['toolCalls'] = [];

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const response = await client.chat.completions.create({ model, messages, tools: openAiTools });
        const message = response.choices[0].message;

        if (!message.tool_calls || message.tool_calls.length === 0) {
          return { narration: message.content ?? '', toolCalls };
        }

        messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });

        for (const call of message.tool_calls) {
          const tool = tools.find((t) => t.name === call.function.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: `Ferramenta desconhecida: ${call.function.name}` }),
            });
            continue;
          }
          try {
            const input = JSON.parse(call.function.arguments);
            const result = await tool.execute(input, toolContext);
            toolCalls.push({ name: call.function.name, input, result });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          } catch (err) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: (err as Error).message }),
            });
          }
        }
      }

      throw new Error('Número máximo de chamadas de ferramenta excedido nesta rodada.');
    },
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/ollama-provider.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/ollama-provider.ts tests/llm/ollama-provider.test.ts
git commit -m "feat: add OllamaProvider implementing LlmProvider"
```

---

### Task 5: Fábrica de provedor

**Files:**
- Create: `src/llm/create-provider.ts`
- Test: `tests/llm/create-provider.test.ts`

**Interfaces:**
- Consumes: `Config` de `src/config.ts` (Task 1); `createClaudeProvider` de `src/llm/claude-provider.ts` (Task 3); `createOllamaProvider` de `src/llm/ollama-provider.ts` (Task 4); `LlmProvider` de `src/llm/provider.ts` (Task 1).
- Produces: `function createLlmProvider(config: Config, claudeClient: Anthropic): LlmProvider`.

- [ ] **Step 1: Escrever testes falhos**

`tests/llm/create-provider.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createLlmProvider } from '../../src/llm/create-provider';
import type { Config } from '../../src/config';

describe('createLlmProvider', () => {
  const claudeClient = {} as Anthropic;

  it('devolve um provider com runTurn quando llmProvider é claude', () => {
    const config: Config = {
      discordToken: 'a',
      discordClientId: 'b',
      databaseUrl: 'c',
      anthropicApiKey: 'd',
      llmProvider: 'claude',
    };
    const provider = createLlmProvider(config, claudeClient);
    expect(typeof provider.runTurn).toBe('function');
  });

  it('devolve um provider com runTurn quando llmProvider é ollama', () => {
    const config: Config = {
      discordToken: 'a',
      discordClientId: 'b',
      databaseUrl: 'c',
      anthropicApiKey: 'd',
      llmProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5',
    };
    const provider = createLlmProvider(config, claudeClient);
    expect(typeof provider.runTurn).toBe('function');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/llm/create-provider.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `create-provider.ts`**

`src/llm/create-provider.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config';
import { createClaudeProvider } from './claude-provider';
import { createOllamaProvider } from './ollama-provider';
import type { LlmProvider } from './provider';

export function createLlmProvider(config: Config, claudeClient: Anthropic): LlmProvider {
  if (config.llmProvider === 'claude') {
    return createClaudeProvider(claudeClient);
  }
  return createOllamaProvider(config.ollamaBaseUrl, config.ollamaModel);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/llm/create-provider.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/llm/create-provider.ts tests/llm/create-provider.test.ts
git commit -m "feat: add llm provider factory"
```

---

### Task 6: Construção do system prompt (contexto)

**Files:**
- Create: `src/llm/context.ts`
- Test: `tests/llm/context.test.ts`

**Interfaces:**
- Consumes: nenhuma dependência de código de planos anteriores (só strings).
- Produces: `function buildSystemPrompt(params: { campaignName: string; lore: string; sessionSummary: string; rulesetName: string }): string`.

Esta task é idêntica à do plano original (independe do provedor de LLM escolhido).

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

### Task 7: Resumo de sessão + persistência

**Files:**
- Create: `src/llm/session-summary.ts`
- Modify: `src/db/campaigns-repo.ts` (Plano 2, Task 2) — adicionar `updateSessionSummary`
- Test: `tests/llm/session-summary.test.ts`
- Modify: `tests/db/campaigns-repo.test.ts` (Plano 2, Task 2) — cobrir `updateSessionSummary`

**Interfaces:**
- Consumes: `Campaign` de `src/db/campaigns-repo.ts`.
- Produces: `function appendToSessionSummary(current: string, exchange: string, maxLength?: number): string`; `async function updateSessionSummary(pool: Pool, campaignId: string, sessionSummary: string): Promise<void>` (adicionada a `campaigns-repo.ts`).

Esta task é idêntica à do plano original (independe do provedor de LLM escolhido).

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

### Task 8: Handler de mensagens do Discord

**Files:**
- Create: `src/bot/message-handler.ts`
- Test: `tests/bot/message-handler.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `updateSessionSummary` de `src/db/campaigns-repo.ts` (Plano 2, Task 5); `getCharacterByPlayer` de `src/db/characters-repo.ts` (Plano 2, Task 3); `LlmProvider` de `src/llm/provider.ts` (Task 1); `fazerTesteTool`, `consultarFichaTool` de `src/llm/tools.ts` (Task 2); `buildSystemPrompt` de `src/llm/context.ts` (Task 6); `appendToSessionSummary` de `src/llm/session-summary.ts` (Task 7).
- Produces: `async function handleMessage(message: Message, pool: Pool, llmProvider: LlmProvider): Promise<void>`.

O handler depende só da interface `LlmProvider` — nunca de `Anthropic` ou `OpenAI` diretamente. Isso também simplifica os testes: em vez de espionar um módulo namespace, basta passar um objeto `LlmProvider` fake com um `runTurn` mockado.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/message-handler.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { createCharacter } from '../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';
import { handleMessage } from '../../src/bot/message-handler';
import type { LlmProvider } from '../../src/llm/provider';

describe('handleMessage', () => {
  let pool: Pool;

  function makeLlmProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
    return {
      runTurn: vi.fn().mockResolvedValue({ narration: 'Você vê uma sala empoeirada.', toolCalls: [] }),
      ...overrides,
    };
  }

  beforeEach(async () => {
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
    const llmProvider = makeLlmProvider();
    await handleMessage(makeMessage('oi', 'bot-1', true), pool, llmProvider);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('ignora mensagens em canais sem campanha ativa', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('oi');
    message.channelId = 'channel-sem-campanha';
    await handleMessage(message, pool, llmProvider);
    expect(llmProvider.runTurn).not.toHaveBeenCalled();
  });

  it('pede para criar personagem quando o autor não tem ficha na campanha', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala', 'player-sem-ficha');
    await handleMessage(message, pool, llmProvider);
    expect(message._replies[0]).toMatch(/criar-personagem/);
  });

  it('chama o provedor de LLM e responde com a narração', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
    expect(message._replies[0]).toBe('Você vê uma sala empoeirada.');
  });

  it('passa as tools fazer_teste e consultar_ficha para o provedor', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
    const toolsArg = (llmProvider.runTurn as any).mock.calls[0][2] as { name: string }[];
    expect(toolsArg.map((t) => t.name)).toEqual(['fazer_teste', 'consultar_ficha']);
  });

  it('atualiza o resumo da sessão após a resposta', async () => {
    const llmProvider = makeLlmProvider();
    const message = makeMessage('eu examino a sala');
    await handleMessage(message, pool, llmProvider);
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
import { getCampaignByChannel, updateSessionSummary } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import type { LlmProvider } from '../llm/provider';
import { fazerTesteTool, consultarFichaTool } from '../llm/tools';
import { buildSystemPrompt } from '../llm/context';
import { appendToSessionSummary } from '../llm/session-summary';

export async function handleMessage(message: Message, pool: Pool, llmProvider: LlmProvider): Promise<void> {
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

  const result = await llmProvider.runTurn(
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
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/message-handler.ts tests/bot/message-handler.test.ts
git commit -m "feat: add narrative message handler wired to LlmProvider"
```

---

### Task 9: Wiring final e smoke test manual

**Files:**
- Modify: `src/index.ts` (Plano 2, Task 8) — cria `claudeClient` (para ingestão, Plano 5) e `llmProvider` (para o laço narrativo), registra o listener `messageCreate`

**Interfaces:**
- Consumes: `createClaudeClient` (Task 1); `createLlmProvider` (Task 5); `handleMessage` (Task 8); `loadConfig`, `createPool`, `createDiscordClient`, `routeInteraction` (Plano 2).

- [ ] **Step 1: Substituir `src/index.ts` inteiro**

`src/index.ts`:
```ts
import 'dotenv/config';
import { createPool } from './db/pool';
import { createDiscordClient } from './bot/client';
import { routeInteraction } from './bot/interaction-router';
import { handleMessage } from './bot/message-handler';
import { createClaudeClient } from './llm/claude-client';
import { createLlmProvider } from './llm/create-provider';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = createDiscordClient();
  const claudeClient = createClaudeClient(config.anthropicApiKey); // usado na ingestão de documentos (Plano 5), sempre Claude
  const llmProvider = createLlmProvider(config, claudeClient); // laço narrativo/combate, agnóstico de provedor

  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool).catch((err) => {
      console.error('Erro ao processar interação:', err);
    });
  });

  client.on('messageCreate', (message) => {
    handleMessage(message, pool, llmProvider).catch((err) => {
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

- [ ] **Step 3: Smoke test manual com Claude**

1. Preencher `ANTHROPIC_API_KEY` no `.env` com uma chave válida; deixar `LLM_PROVIDER=claude` (ou omitir, já que é o padrão).
2. Rodar `npm run dev` e, no servidor de teste (já configurado no Plano 2), rodar `/criar-campanha` e `/criar-personagem` se ainda não existirem.
3. Escrever no canal da campanha uma ação livre, ex: "eu examino a sala em busca de armadilhas" — confirmar que o bot responde com uma narração coerente.
4. Escrever uma ação que exija teste, ex: "eu tento escalar o muro da torre" — confirmar que a narração reflete um resultado de sucesso/falha consistente.
5. Escrever uma segunda mensagem na sequência e confirmar que a narração faz referência ao que aconteceu antes (resumo de sessão funcionando).

- [ ] **Step 4: Smoke test manual com Ollama (opcional, requer Ollama instalado localmente)**

1. Instalar o [Ollama](https://ollama.com) e rodar `ollama pull qwen2.5` (ou outro modelo com suporte a tool calling).
2. No `.env`, definir `LLM_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434`, `OLLAMA_MODEL=qwen2.5`. Manter `ANTHROPIC_API_KEY` preenchida (ainda é usada na ingestão de documentos).
3. Rodar `npm run dev` e repetir os passos 3-5 do smoke test com Claude.
4. Comparar qualidade e latência das respostas com o smoke test do Claude — é esperado que um modelo local seja mais lento e menos consistente em obedecer a instrução de sempre chamar `fazer_teste`; documentar quaisquer falhas observadas.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire multi-provider narrative loop into the bot entry point"
```

---

## Self-Review

**Cobertura da spec:** cobre o fluxo "fora de combate" do design — o mestre narra, chama `fazer_teste` quando necessário, nunca inventa números, e a continuidade entre mensagens é mantida via resumo de sessão. Adiciona, além do design original, a capacidade de trocar o provedor de LLM (Claude ou um modelo local via Ollama) sem alterar o handler de mensagens nem as tools — só a fábrica `createLlmProvider` muda. Combate por turnos (Plano 4) e ingestão de documento (Plano 5) ficam para os próximos planos; a ingestão continua fixa em Claude, deliberadamente, por ser uma operação única onde a confiabilidade importa mais que o custo.

**Placeholders:** nenhum — todo código é completo; os Steps 3 e 4 da Task 9 são deliberadamente manuais (requerem uma chave de API real da Anthropic e, opcionalmente, um Ollama local), mas cada verificação é concreta.

**Consistência de tipos:** `LlmProvider`, `GameMasterTurnResult` são definidos uma vez (Task 1) e implementados sem variação por `ClaudeProvider` e `OllamaProvider`; `message-handler.ts` depende só dessa interface. `ToolContext`, `ToolDefinition` (Task 2) são reutilizados sem renomear em ambos os provedores. `Config` vira uma união discriminada por `llmProvider`, consistente entre `config.ts`, `create-provider.ts`, `index.ts` e os testes — `anthropicApiKey` está sempre presente independente do provedor escolhido, o que mantém a Task 9's uso de `createClaudeClient(config.anthropicApiKey)` válido em qualquer configuração.
