# Estado canônico rico + retrieval (Opção C) — Design de evolução

> **Status:** especificação futura — **não implementar agora**.
> **Pré-requisito entregue:** [Memória em 3 camadas (Opção A)](2026-07-08-memoria-em-camadas-design.md).
> **Roadmap relacionado:** [Próximos passos de memória e prompt](2026-07-09-proximos-passos-memoria-e-prompt.md).

## Por que esta spec existe

A Opção A (memória em camadas) resolve o problema imediato do `sessionSummary` blob truncado: o prompt passa a ter Working Memory estruturada + buffer das últimas N trocas, e a coerência de curto/médio prazo deixa de depender de um corte arbitrário de 4k caracteres.

A Opção C ataca o próximo gargalo, típico de produção com Ollama 7B e sessões longas:

1. A **lore inteira** ainda vai no system prompt a cada turno — cresce com a campanha e compete com fatos/trocas por tokens.
2. `fatosCruciais[]` é uma lista plana sem tipagem (NPC vs local vs plot thread) e sem retrieval seletivo — tudo ou nada.
3. Não há entidade canônica consultável (ex.: “o que o jogador sabe sobre o Rei?”) além do que couber na lista de fatos.

Esta spec descreve o caminho para **estado canônico no Postgres + retrieval por turno**, mantendo o prompt curto e o 7B coerente.

## O que a Opção A já entrega (não refazer)

| Camada | Onde vive | Atualização |
|--------|-----------|-------------|
| Hard Memory (`lore`) | `campaigns.lore` | Ingestão / revisão de rascunho |
| Working Memory | `ritmo_atual`, `proximo_marco`, `fatos_cruciais` | Reflexão a cada 10 mensagens |
| Short-term | `recent_exchanges` (últimas 5) | Após cada turno narrativo |

A Opção C **estende** Working Memory e Hard Memory; não substitui o buffer de trocas nem o ciclo de reflexão.

## Objetivo

- Persistir fatos, NPCs, locais e plot threads como **registros tipados** (estado canônico), não só strings numa lista JSON.
- Em cada turno narrativo, **selecionar** um subconjunto relevante para o prompt (retrieval), em vez de dumpar lore + todos os fatos.
- Manter latência aceitável no caminho crítico: retrieval síncrono barato (SQL/texto); consolidação/extração continua fora do caminho crítico (como a reflexão da Opção A).
- Continuar funcionando com `LLM_PROVIDER=ollama` (7B) e `claude`, sem exigir embeddings no MVP da Opção C.

## Fora de escopo (desta spec / desta fase)

- Implementação imediata (código, migrações, tools).
- Troca de modelo para 3B ou qualquer downgrade de capacidade.
- Embedding / `pgvector` no primeiro corte da Opção C (ver fase opcional abaixo).
- Reescrever combate ou o fluxo de rascunho.
- Migrar automaticamente a `lore` monólito para entidades tipadas na primeira entrega (pode ser gradual).

## Arquitetura alvo

```
handleMessage()
        │
        ▼
  retrieveCanonicalContext(campaignId, playerMessage, workingMemory)
        │  ← SQL/texto: top-K fatos/NPCs/locais/threads relevantes
        ▼
  buildSystemPrompt({
    loreDigest OR loreChunks selecionados,   // não dump inteiro
    ritmoAtual, proximoMarco,                // Working Memory (A)
    retrievedEntities,                       // canônico (C)
    recentExchanges,                         // Short-term (A)
  })
        │
        ▼
  llmProvider.runTurn(...)  → reply ao jogador
        │
        ▼
  appendExchange + maybeRunReflection (A)
        │
        └── (futuro) maybeExtractCanonicalUpdates(...)
              segunda chamada / mesma reflexão estendida
              persiste fatos/NPCs/locais/threads no Postgres
```

A reflexão da Opção A pode evoluir para também emitir updates canônicos (tools adicionais ou uma tool mais rica), ou um ciclo separado com o mesmo padrão de no-op silencioso se o 7B não chamar a tool.

## Modelo de dados (proposta)

Migração futura (ex. `005_estado_canonico.sql`) — nomes ilustrativos:

```sql
-- Fatos tipados (substitui gradualmente o JSONB fatos_cruciais como fonte da verdade)
CREATE TABLE campaign_facts (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- 'fact' | 'rumor' | 'secret' (opcional)
  body TEXT NOT NULL,
  importance SMALLINT NOT NULL DEFAULT 1,  -- 1..5, para ranking
  tags TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE campaign_npcs (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  disposition TEXT NOT NULL DEFAULT '',   -- aliado, hostil, neutro, etc.
  location_id UUID NULL,                 -- FK opcional para campaign_locations
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE campaign_locations (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  parent_id UUID NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE campaign_plot_threads (
  id UUID PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open | resolved | dormant
  summary TEXT NOT NULL DEFAULT '',
  next_hook TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_campaign_facts_campaign ON campaign_facts(campaign_id) WHERE active;
CREATE INDEX idx_campaign_npcs_campaign ON campaign_npcs(campaign_id) WHERE active;
-- etc.
```

`campaigns.fatos_cruciais` pode permanecer como **cache derivado** (lista curta para o prompt) gerada a partir dos fatos ativos de maior importância, até a Working Memory passar a ler só do canônico.

### Lore

Fases sugeridas:

1. **Digest:** manter `lore` completa no banco; no prompt, usar só um resumo curto (`lore_digest` TEXT) + chunks recuperados.
2. **Chunking:** partir a lore em `campaign_lore_chunks (id, campaign_id, heading, body, tags)` na ingestão; retrieval por palavra-chave / tags / localização atual.
3. **Embeddings (opcional):** coluna `embedding vector(...)` + `pgvector` se keyword retrieval não bastar.

## Retrieval por turno (MVP da Opção C)

Sem embeddings no primeiro corte:

1. Extrair termos da mensagem do jogador + `proximoMarco` + nomes em `recentExchanges`.
2. Buscar por `ILIKE` / `tags &&` / overlap de tokens em fatos, NPCs, locais e threads ativos.
3. Rankear por `importance`, menção explícita de nome, e status de plot thread (`open` > `dormant`).
4. Limitar a orçamento fixo de tokens/caracteres (ex.: ≤ N fatos, ≤ M NPCs, ≤ 1 local atual, ≤ 2 threads).
5. Montar seção `Contexto recuperado:` no system prompt; **não** incluir a lore monólito inteira.

Fallback: se retrieval devolver vazio, incluir só Working Memory (A) + digest da lore + short-term.

## Consolidação canônica

Estender o ciclo de reflexão (ou ciclo irmão a cada N mensagens):

- Tools candidatas: `upsert_fato`, `upsert_npc`, `upsert_local`, `upsert_plot_thread`, `resolver_plot_thread`.
- Mesmo contrato da Opção A: sem `tool_choice` forçado; no-op se o 7B não chamar; nunca atrasar a resposta ao jogador.
- Validação estrita de input na `execute` (padrão já usado em `atualizar_estado_narrativo`).

## Prompt rígido (evolução do `buildSystemPrompt`)

Ordem sugerida de seções (estável para o 7B):

1. Papel + regras duras (nunca inventar dados / usar tools).
2. Digest da lore (curto).
3. Ritmo + próximo marco (Working Memory).
4. Contexto recuperado (canônico, top-K).
5. Últimas trocas (Short-term).
6. Instruções de combate (se aplicável).

## Estratégia de testes (quando for implementar)

- Repositórios: CRUD + soft-deactivate de entidades canônicas.
- Retrieval: ranking determinístico com fixtures; orçamento de tamanho respeitado.
- `buildSystemPrompt`: lore monólito ausente quando digest+retrieval presentes.
- Reflexão/extração: no-op silencioso; falha não propaga; persistência só via tool.
- Integração em `message-handler`: retrieval chamado antes de `runTurn`; reflexão depois do reply.

## Critérios para puxar esta spec para implementação

- Sessões reais na VPS onde o 7B contradiz fatos já estabelecidos apesar da Opção A.
- Lore de campanha grande demais para caber confortavelmente no contexto junto com trocas + fatos.
- Necessidade de consultar entidades (“onde está X?”, “o que sabemos sobre Y?”) de forma estável entre sessões.

## Relação com outras opções

| Opção | Entrega | Quando |
|-------|---------|--------|
| **A** (feita) | Prompt em camadas + reflexão + buffer de trocas | Agora |
| **C** (esta) | Estado canônico tipado + retrieval por turno | Depois, se A não bastar |
| Embeddings / RAG | Retrieval semântico sobre chunks/fatos | Só se keyword retrieval falhar |
| Ficha no prompt | Snapshot controlado de atributos/HP/inventário | Ver [próximos passos](2026-07-09-proximos-passos-memoria-e-prompt.md) |

## Self-Review

**Cobertura:** motiva o salto A→C, modelo de dados, retrieval sem embeddings, consolidação, prompt, testes e critérios de go/no-go. **Consistência:** reaproveita o padrão de reflexão/tool da Opção A; não inventa um segundo pipeline no caminho crítico. **Escopo:** documento de evolução apenas — zero obrigação de código nesta data.
