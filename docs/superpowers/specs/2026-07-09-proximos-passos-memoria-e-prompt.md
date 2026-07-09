# Próximos passos — memória, prompt e coerência (pós Opção A)

> **Status:** backlog de design — **não implementar agora**, salvo indicação explícita.
> **Entregue agora:** [Memória em 3 camadas (Opção A)](2026-07-08-memoria-em-camadas-design.md).
> **Evolução principal:** [Estado canônico + retrieval (Opção C)](2026-07-09-estado-canonico-e-retrieval-design.md).

## O que a Opção A entrega agora

Implementado conforme a spec de 2026-07-08:

- Migração `004_memoria_em_camadas.sql`: remove `session_summary`; adiciona `recent_exchanges`, `ritmo_atual`, `proximo_marco`, `fatos_cruciais`, `messages_since_reflection`.
- System prompt com seções explícitas: lore (Hard) + fatos/ritmo/marco (Working) + últimas 5 trocas (Short-term).
- Reflexão a cada 10 mensagens via tool `atualizar_estado_narrativo` (no-op se o 7B não chamar a tool).
- Buffer FIFO por contagem de trocas — não corta no meio de uma mensagem por limite de 4k chars.

**Ainda não muda (de propósito):**

- Lore inteira continua no prompt.
- Ficha/inventário só via tool `consultar_ficha`.
- Sem histórico de mensagens no provider (continua system + user do turno).
- Sem embeddings / `pgvector`.
- Sem entidades tipadas (NPC/local/plot) além da lista `fatos_cruciais[]`.

## Matriz A vs depois

| Capacidade | Opção A (agora) | Depois |
|------------|-----------------|--------|
| Buffer recente estruturado | Sim (5 trocas) | Ajustar N se necessário |
| Estado de trama (ritmo/marco/fatos) | Sim (reflexão) | Enriquecer / tipar (C) |
| Lore no prompt | Dump completo | Digest + retrieval (C) |
| Fatos tipados / NPCs / locais / threads | Não | Spec C |
| Retrieval por turno | Não | Spec C |
| Embeddings / RAG | Não | Só se C keyword falhar |
| Ficha no prompt | Não (só tool) | Snapshot controlado (abaixo) |
| `tomDeVoz` na Working Memory | Não | Campo extra na mesma reflexão |
| `tool_choice` forçado na reflexão | Não | Só se no-op do 7B for frequente demais |

## Backlog priorizado (sugestão)

### 1. Observar a Opção A em produção (VPS + Ollama 7B)

Antes de codar C:

- A reflexão está chamando a tool com frequência útil, ou quase sempre no-op?
- Fatos cruciais estão estabilizando a trama entre sessões?
- O prompt ainda estoura / degrada com lore grande?

Só puxar C se houver evidência (contradições, amnésia de plot, lore enorme).

### 2. Estado canônico + retrieval (Opção C)

Ver [2026-07-09-estado-canonico-e-retrieval-design.md](2026-07-09-estado-canonico-e-retrieval-design.md).

É o próximo salto arquitetural se A não bastar. Mantém prompt curto; coerência via Postgres.

### 3. Snapshot controlado de ficha / inventário no prompt

**Problema:** o 7B às vezes narra HP/itens errados se não chamar `consultar_ficha`.

**Direção (quando for a hora):**

- Incluir no system prompt um bloco curto e **somente leitura**, gerado em código a partir da ficha do personagem atuante, ex.:
  - nome, atributos principais, HP atual/máx (se existir máx), inventário resumido (N itens).
- Manter `consultar_ficha` para detalhes ou outros personagens.
- Nunca deixar o modelo “atualizar” a ficha pelo texto do prompt — mutações só via tools / motor de regras.
- Orçamento fixo de caracteres; inventário truncado com “(+K itens)”.

**Fora deste item:** inventário de todo o grupo no prompt; dump da ficha JSON completa.

### 4. `tomDeVoz` na Working Memory

Campo opcional na mesma tool de reflexão (`tom_de_voz: string`), renderizado no prompt. Sem mudança estrutural — só mais uma coluna/`UPDATE` na Working Memory. Útil se o tom da mesa oscilar demais entre turnos.

### 5. Embeddings / `pgvector` (condicional)

Só depois do retrieval por keyword/tags da Opção C provar insuficiente. Requer:

- Extensão `pgvector` no Postgres da VPS.
- Pipeline de embed na consolidação (custo/latência).
- Decisão de modelo de embedding local vs API.

### 6. Endurecer a reflexão no 7B (só se necessário)

Se medição mostrar no-op frequente:

- Prompt de reflexão mais curto e imperativo.
- Fallback heurístico (sem LLM): extrair nomes próprios das últimas trocas e acrescentar a `fatos_cruciais` com teto de tamanho — último recurso, documentar bem.
- `tool_choice` forçado exigiria estender `LlmProvider` nos dois backends — custo alto; só com evidência forte.

### 7. Histórico de mensagens no provider

Hoje: uma mensagem de usuário por turno. Alternativa futura: passar as últimas N trocas como mensagens `user`/`assistant` no chat API **em vez de** (ou além de) embuti-las no system prompt. Avaliar impacto no Ollama 7B (alguns modelos seguem melhor o system; outros, o histórico). Não misturar as duas formas sem medir.

## Como evoluir sem quebrar A

1. Novas colunas/tabelas com defaults seguros.
2. `buildSystemPrompt` ganha seções opcionais; seções da A permanecem.
3. Retrieval e extração canônica entram como módulos novos (`src/llm/retrieval.ts`, `src/db/*-repo.ts`), não como rewrite do message-handler.
4. Reflexão continua after-reply e fail-soft.

## Links

- Spec A: [2026-07-08-memoria-em-camadas-design.md](2026-07-08-memoria-em-camadas-design.md)
- Plano A: [../plans/2026-07-08-07-memoria-em-camadas.md](../plans/2026-07-08-07-memoria-em-camadas.md)
- Spec C: [2026-07-09-estado-canonico-e-retrieval-design.md](2026-07-09-estado-canonico-e-retrieval-design.md)
- Nota de pesquisa: [../../notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md](../../notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md)
