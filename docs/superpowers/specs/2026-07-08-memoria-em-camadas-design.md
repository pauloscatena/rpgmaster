# Memória em 3 camadas (Hard/Working/Short-term) — Design

> **Evolução (não implementar nesta feature):** [Estado canônico + retrieval (Opção C)](2026-07-09-estado-canonico-e-retrieval-design.md) · [Próximos passos de memória e prompt](2026-07-09-proximos-passos-memoria-e-prompt.md)

## Visão geral

Hoje a memória narrativa de uma campanha (fora da `lore` fixa) é um único campo, `sessionSummary`, que acumula texto livre a cada troca e é truncado por tamanho de caractere quando fica grande demais (`appendToSessionSummary` em `src/llm/session-summary.ts`). Isso mistura duas coisas de natureza diferente — o estado de trama em evolução (o que está em jogo agora, para onde a história está indo) e o histórico recente da conversa — no mesmo blob, sem estrutura, e o corte por tamanho pode partir uma troca no meio.

Esta feature separa a memória narrativa em 3 camadas, inspiradas numa conversa de pesquisa externa sobre arquitetura de bots de RPG ([docs/notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md](../../notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md)):

1. **Hard Memory** — a `lore` da campanha. Já existe, não muda nesta feature.
2. **Working Memory** — `ritmoAtual`, `proximoMarco` e `fatosCruciais[]`. Atualizada periodicamente por um ciclo de reflexão automático, não a cada turno.
3. **Short-term Context** — `recentExchanges[]`. Buffer estruturado das últimas trocas brutas (jogador + narração), substituindo o truncamento por tamanho.

### Objetivo

- Dar ao LLM um contexto narrativo mais estável em sessões longas: fatos que ainda importam não desaparecem por causa de um corte de texto arbitrário, e o "ritmo" da cena (ação, mistério, descanso) e a próxima meta narrativa ficam explícitos em vez de implícitos num resumo em prosa.
- Manter o custo/latência controlados: a reflexão roda a cada N mensagens (não a cada turno) e nunca atrasa a resposta ao jogador — ela acontece depois que a narração já foi enviada.
- Funcionar igualmente bem com `LLM_PROVIDER=claude` e `LLM_PROVIDER=ollama`, sem exigir sempre uma chamada paga ao Claude.

### Fora de escopo

- **`tomDeVoz`**: a conversa original também sugere um campo de tom de voz na Working Memory. Não faz parte deste design — pode ser adicionado depois como mais um campo no mesmo mecanismo de reflexão, sem mudança estrutural.
- **Busca vetorial / `pgvector`**: a `lore` continua sendo um campo de texto simples; não há necessidade de indexação semântica hoje.
- **Forçar a chamada da tool de reflexão** (`tool_choice`): a reflexão usa o `LlmProvider` normal (Claude ou Ollama, o que estiver configurado) sem forçar o uso da tool. Se o modelo não chamar a tool nesse ciclo — mais provável com um modelo local mais fraco — o ciclo é um no-op silencioso, e a Working Memory permanece com o valor anterior até o próximo ciclo, 10 mensagens depois. Forçar `tool_choice` exigiria estender a interface `LlmProvider` (usada por todo turno narrativo e de combate) nos dois providers — fora de escopo aqui.
- **Reescrever combate**: a reflexão roda independente de estar em combate ou não (é uma chamada `runTurn` isolada, com uma única tool própria), mas nenhuma tool ou fluxo de combate existente muda.
- **Migração do dado antigo**: o `session_summary` acumulado em campanhas já existentes é descartado na migração (decisão explícita — ver seção de Componentes). Não há tentativa de encaixar o texto livre antigo no novo formato estruturado.

## Arquitetura

```
handleMessage() (fora do fluxo de rascunho/pausada)
        │
        ▼
  llmProvider.runTurn(...)  ← turno normal, narrativo ou de combate (inalterado)
        │
        ▼
  message.reply(result.narration)   ← jogador já recebeu a resposta
        │
        ▼
  appendExchange(recentExchanges, novaTroca, 5)   ← Short-term Context (FIFO)
  messagesSinceReflection += 1
        │
        ├── se messagesSinceReflection < 10 → persiste e encerra o turno
        │
        └── se messagesSinceReflection >= 10:
                │
                ▼
          maybeRunReflection(...)
                │
                ▼
          llmProvider.runTurn(reflectionSystemPrompt, reflectionUserMessage,
                               [atualizarEstadoNarrativoTool], toolContext)
                │
                ├── modelo chama a tool → atualizarEstadoNarrativoTool.execute
                │        persiste ritmoAtual/proximoMarco/fatosCruciais direto no Postgres
                │
                └── modelo não chama a tool → no-op (estado anterior mantido)
                │
                ▼
          messagesSinceReflection reseta para 0 (nos dois casos)
```

A chamada de reflexão é sempre uma segunda chamada ao `runTurn`, separada da chamada narrativa do turno — nunca compartilha o mesmo array de tools nem a mesma resposta. Isso preserva o comportamento atual do turno principal (narrativo ou de combate) inalterado; a reflexão é puramente aditiva e acontece depois, fora do caminho crítico de resposta ao jogador.

## Componentes e fluxo de dados

### Migração `004_memoria_em_camadas.sql`

```sql
ALTER TABLE campaigns DROP COLUMN session_summary;
ALTER TABLE campaigns ADD COLUMN recent_exchanges JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN ritmo_atual TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN proximo_marco TEXT NOT NULL DEFAULT '';
ALTER TABLE campaigns ADD COLUMN fatos_cruciais JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaigns ADD COLUMN messages_since_reflection INT NOT NULL DEFAULT 0;
```

Descarta o `session_summary` acumulado de campanhas em andamento (decisão explícita do usuário — aceitável dado o estágio inicial do projeto). `src/db/test-db.ts` já reaplica todas as migrações do zero em cada teste, então nenhuma mudança é necessária lá.

### `Campaign` (`src/db/campaigns-repo.ts`)

Troca:
```ts
sessionSummary: string;
```
por:
```ts
recentExchanges: RecentExchange[];
ritmoAtual: string;
proximoMarco: string;
fatosCruciais: string[];
messagesSinceReflection: number;
```
onde `RecentExchange = { characterName: string; playerMessage: string; narration: string }` (tipo exportado de `src/llm/short-term-memory.ts`).

`rowToCampaign` ganha o parsing dos 4 campos novos (`JSON.parse` para os dois `jsonb`, leitura direta para os dois `text`/`int`).

`updateSessionSummary(pool, campaignId, sessionSummary)` é removida e substituída por:
- `updateRecentExchanges(pool, campaignId, recentExchanges: RecentExchange[]): Promise<void>` — grava o buffer e incrementa `messages_since_reflection` num único `UPDATE`.
- `updateNarrativeState(pool, campaignId, params: { ritmoAtual: string; proximoMarco: string; fatosCruciais: string[] }): Promise<void>` — grava a Working Memory e zera `messages_since_reflection`, num único `UPDATE`.

### `src/llm/short-term-memory.ts` (substitui `src/llm/session-summary.ts`)

```ts
export interface RecentExchange {
  characterName: string;
  playerMessage: string;
  narration: string;
}

export function appendExchange(
  current: RecentExchange[],
  exchange: RecentExchange,
  maxSize = 5
): RecentExchange[] {
  return [...current, exchange].slice(-maxSize);
}
```

Função pura, mesmo espírito de `appendToSessionSummary` mas por contagem de trocas (FIFO), não por tamanho de string.

### `src/llm/narrative-memory.ts` (novo)

- `REFLECTION_INTERVAL = 10` — limiar de mensagens entre ciclos de reflexão.
- `atualizarEstadoNarrativoTool: ToolDefinition` — a única tool oferecida na chamada de reflexão:
  ```ts
  inputSchema: {
    type: 'object',
    properties: {
      ritmo_atual: { type: 'string', description: 'Ritmo atual da cena: ação, mistério, descanso, etc.' },
      proximo_marco: { type: 'string', description: 'Próxima meta narrativa de curto prazo planejada pelo mestre.' },
      fatos_cruciais: {
        type: 'array', items: { type: 'string' },
        description: 'Lista completa e atualizada de fatos que ainda importam para a história. Inclua os que continuam relevantes e remova os que ficaram irrelevantes.',
      },
    },
    required: ['ritmo_atual', 'proximo_marco', 'fatos_cruciais'],
  }
  ```
  `execute(input, ctx)` exige `ctx.narrativeMemory` (mesmo padrão de `requireCombat` em `combat-tools.ts`) e chama `updateNarrativeState(...)` diretamente — persistência dentro da tool, não delegada ao chamador.
- `buildReflectionPrompt(params: { ritmoAtual: string; proximoMarco: string; fatosCruciais: string[]; recentExchanges: RecentExchange[] }): { system: string; user: string }` — monta um system prompt instruindo o modelo a analisar as últimas trocas e o estado atual, e a sempre chamar `atualizar_estado_narrativo` com o estado revisado (carregando adiante fatos ainda relevantes, descartando os que não são mais).
- `maybeRunReflection(params: { pool: Pool; campaignId: string; campaign: Campaign; llmProvider: LlmProvider; config: ValidatedRulesetConfig; actingCharacter: StoredCharacter; rng: Rng }): Promise<void>` — checa `campaign.messagesSinceReflection >= REFLECTION_INTERVAL`; se não, retorna sem fazer nada. Se sim, monta o prompt, chama `llmProvider.runTurn(system, user, [atualizarEstadoNarrativoTool], { config, actingCharacter, rng, narrativeMemory: { pool, campaignId } })`, e sempre zera o contador ao final (a tool já zera via `updateNarrativeState` quando é chamada; se não for chamada, `maybeRunReflection` zera explicitamente para não tentar de novo na mensagem seguinte).

### `ToolContext` (`src/llm/tools.ts`)

Ganha um campo opcional, espelhando `combat?`:
```ts
narrativeMemory?: { pool: Pool; campaignId: string };
```

### `buildSystemPrompt` (`src/llm/context.ts`)

Troca o parâmetro `sessionSummary: string` por `ritmoAtual`, `proximoMarco`, `fatosCruciais: string[]`, `recentExchanges: RecentExchange[]`, renderizando cada camada em uma seção própria do prompt (lore continua igual; fatos cruciais como lista; ritmo e próximo marco como linhas próprias; últimas trocas formatadas como `Jogador (<nome>): ...` / `Mestre: ...`).

### `handleMessage` (`src/bot/message-handler.ts`)

Depois de `message.reply(result.narration)`: monta a `RecentExchange`, chama `appendExchange` + `updateRecentExchanges`, então chama `maybeRunReflection(...)` dentro do mesmo `try` (ou um `try` próprio, para que uma falha na reflexão nunca derrube o restante do turno — ver Tratamento de erros).

## Tratamento de erros

- Qualquer falha na chamada de reflexão (timeout do `LlmProvider` — já coberto por `LLM_REQUEST_TIMEOUT_MS` —, erro do provedor, exceção na tool) é capturada num `try/catch` dedicado dentro de `maybeRunReflection` (ou ao redor da chamada em `handleMessage`), logada com `console.error`, e nunca propaga. A resposta ao jogador já foi enviada antes desse ciclo começar, então uma falha aqui é invisível para quem está jogando.
- Se o modelo não chamar `atualizar_estado_narrativo` nessa rodada, isso não é um erro — é o comportamento aceito (decidido acima): a Working Memory permanece com o valor anterior, e o contador zera do mesmo jeito para tentar de novo dali a 10 mensagens.
- Entrada inválida da tool (ex: `fatos_cruciais` não é array) é validada em `execute`, seguindo o mesmo padrão de `fazerTesteTool`/`consultarFichaTool` (lança erro claro, capturado pelo loop de tool-calling do provider, que devolve `tool_result` com `is_error`/mensagem de erro — igual ao tratamento já existente para ferramentas desconhecidas).

## Estratégia de testes

- **`appendExchange`** (`tests/llm/short-term-memory.test.ts`): mantém as últimas N trocas, descarta as mais antigas, funciona com buffer vazio.
- **`atualizarEstadoNarrativoTool`** (`tests/llm/narrative-memory.test.ts`): persiste `ritmoAtual`/`proximoMarco`/`fatosCruciais` via `updateNarrativeState`, lança erro claro sem `ctx.narrativeMemory`, valida tipo de `fatos_cruciais`.
- **`buildReflectionPrompt`**: inclui o estado atual e as trocas recentes no prompt montado.
- **`maybeRunReflection`**: não dispara chamada nenhuma quando `messagesSinceReflection < REFLECTION_INTERVAL`; dispara e persiste quando atinge o limiar; zera o contador tanto quando a tool é chamada quanto quando não é; não propaga erro do `llmProvider.runTurn`.
- **`campaigns-repo`**: `updateRecentExchanges` e `updateNarrativeState` persistem e são lidos de volta corretamente via `rowToCampaign`.
- **`message-handler.test.ts`** (integração, reaproveitando o padrão já existente de `createTestPool`): contador incrementa a cada turno bem-sucedido; ao atingir 10, uma segunda chamada a `runTurn` acontece (mock com `mockResolvedValueOnce` para a chamada narrativa e outra para a de reflexão); falha na reflexão não impede a resposta normal ao jogador nem propaga.

## Self-Review

**Cobertura**: todas as seções (arquitetura, migração, módulos, contexto, erros, testes) especificadas sem placeholders, com nomes de arquivo/função/coluna concretos. **Consistência**: a reflexão reaproveita exatamente o mesmo mecanismo de tool-calling (`ToolDefinition`/`ToolContext`/`llmProvider.runTurn`) já usado por `combat-tools.ts`, incluindo o padrão de contexto opcional (`narrativeMemory?` espelhando `combat?`) e o padrão de persistência dentro do `execute` da tool — nenhum mecanismo novo é inventado. **Escopo**: contido a `src/llm/` (2 arquivos novos, 1 removido), `src/db/campaigns-repo.ts`, `src/llm/context.ts`, `src/bot/message-handler.ts`, `src/llm/tools.ts` e uma migração — adequado para um único plano de implementação. **Ambiguidade**: nenhuma identificada — o corte de dado antigo na migração é explícito, o comportamento de no-op silencioso quando a tool de reflexão não é chamada é explícito e testável, e o momento exato em que a reflexão roda (depois da resposta ao jogador, nunca antes) está definido tanto no diagrama quanto no tratamento de erros.
