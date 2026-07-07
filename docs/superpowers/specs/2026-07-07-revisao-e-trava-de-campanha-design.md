# Revisão e trava de configuração de campanha — Design

## Visão geral

Hoje, quando `/criar-campanha` recebe um documento, a extração de regras (Plano 5) pode ficar incompleta e a campanha entra em `draft`: o bot faz perguntas objetivas até fechar a configuração, e a campanha só vira `active` quando a extração finalmente bate 100% com o schema. Isso pode significar várias rodadas de perguntas antes de começar a jogar — o oposto de "amigável para configurar".

Esse design substitui esse laço de perguntas por um fluxo de **assumir + revisar + travar**: a extração passa a sempre devolver uma configuração completa (inferida do documento, ou assumida a partir do sistema padrão quando não há sinal suficiente), o criador da campanha revisa um resumo e pode ajustar qualquer coisa por texto livre no canal, e só um comando explícito (`/iniciar-campanha`) trava a configuração e começa a sessão de fato. Isso também introduz pausa/retomada de sessão (`/pausar-campanha` / `/retomar-campanha`), lore aleatória para campanhas sem documento, e um comando pra jogador consultar a própria ficha (`/minha-ficha`).

Isso revisa a premissa original do Plano 5 de "nunca assumir um valor sem sinalizar" — agora o sistema assume, mas sempre sinaliza o que assumiu no resumo de revisão, e nada fica travado até o criador confirmar.

## Modelo de status da campanha

`CampaignStatus` passa a ter três valores (hoje só tem `draft` | `active`):

- **`draft`** — significado revisado: a `rulesetConfig` está **sempre completa e válida** nesse estado (nunca mais representa "faltando informação"). A campanha está aberta pra revisão/edição; nenhuma mensagem de jogador é tratada como turno narrativo.
- **`active`** — configuração travada, sessão rodando; mensagens no canal são turnos de jogo (comportamento atual, sem mudança).
- **`paused`** *(novo)* — sessão existente, temporariamente suspensa. Mensagens no canal são ignoradas (mesmo tratamento de "sem campanha" no `message-handler.ts`) até `/retomar-campanha`.

A coluna `campaigns.status` já é `TEXT` sem `CHECK` constraint (`001_init.sql`), então adicionar `'paused'` não exige migração de schema — só o tipo `CampaignStatus` em `src/db/campaigns-repo.ts` e a lógica que o usa.

## Extração sempre completa

`EXTRACTION_SYSTEM_PROMPT` (`src/ingestion/extract.ts`) muda de "preencha só o que tiver certeza, deixe o resto de fora" para: **sempre devolver uma `rulesetConfig` completa**, aplicado tanto na extração inicial (upload do documento) quanto em toda edição durante a revisão (mesmo pipeline, ver próxima seção):

1. Para cada campo estrutural, tentar inferir do documento com o máximo de confiança possível.
2. Para o que não puder ser inferido, preencher com o valor correspondente do sistema padrão (`defaultRulesetConfig()`) — o mesmo JSON que já está embutido no prompt para o atalho "usar padrão" (feature anterior) passa a ser o fallback automático, não mais só sob pedido explícito do usuário.
3. `clarifyingQuestions` deixa de existir para sinalizar campos ausentes — esse conceito não existe mais (a config nunca fica incompleta). Continua existindo só para as poucas ambiguidades de interpretação genuínas (ex: uma coluna do documento que pode virar `attackAttribute` ou `defenseValue`), e essas continuam sempre vindo com uma sugestão concreta (comportamento já existente, mantido).

**Rede de segurança:** depois da resposta do modelo, `validateRulesetConfig` roda normalmente. Se, mesmo com as instruções acima, a config devolvida falhar na validação (erro do modelo, não falta de informação — ex: um `resources` malformado), o código substitui a `rulesetConfig` inteira por `defaultRulesetConfig()` antes de salvar, mantendo a `lore` extraída. Isso garante que uma campanha em `draft` **nunca** fica num estado sem uma config válida — `formatValidationIssues` e a mensagem de "Required" deixam de ter uso prático nesse fluxo (o código pode continuar existindo para os testes unitários do motor de validação, mas não é mais alcançável a partir do fluxo de ingestão).

## Ciclo de revisão e edição

- `/criar-campanha` com documento: roda a extração (sempre completa agora), cria a campanha em `draft`, e responde com um resumo — lore + toda a `rulesetConfig` campo a campo (nome, atributos, dado de teste, recursos, recurso de HP, atributo de ataque, dado de dano, valor de defesa) — terminando com uma chamada à ação, por exemplo:
  > "Isso é o que assumi pra 'Nome da Campanha'. Pode responder aqui com qualquer ajuste, ou já rodar `/iniciar-campanha` pra aceitar como está."
- Qualquer mensagem no canal (ou `/responder-campanha resposta:<...>`) enquanto a campanha está em `draft` continua caindo em `processDraftAnswer` (`src/ingestion/draft-flow.ts`, já existe) — mas essa função **deixa de ativar a campanha sozinha**. Toda edição só roda a extração de novo (documento original + notas acumuladas, comportamento já existente) e atualiza a config salva via `saveDraftProgress`, mostrando o resumo atualizado. Como a extração agora é sempre completa, o branch "ainda incompleto, pergunte de novo" deixa de existir — toda resposta de `processDraftAnswer` é "aqui está o resumo atualizado", nunca mais "ainda faltam N perguntas".
- `DraftAnswerResult` (tipo de retorno de `processDraftAnswer`) muda de `{ activated: boolean; message: string }` para refletir que a ativação não acontece mais aqui — vira só `{ message: string }`, e a campanha permanece em `draft`.

## Comandos novos

### `/iniciar-campanha`

| Status atual | Comportamento |
|---|---|
| `draft` | Trava a `rulesetConfig` (nenhum código depois disso permite editá-la), muda status para `active`, responde confirmando o início com um resumo final. |
| `active` | "Essa campanha já está em andamento." |
| `paused` | "Essa campanha está pausada. Use `/retomar-campanha` para continuar." |
| sem campanha no canal | "Nenhuma campanha encontrada neste canal." |

### `/pausar-campanha`

| Status atual | Comportamento |
|---|---|
| `active` | Muda status para `paused`, confirma. |
| `draft` | "Essa campanha ainda não começou. Use `/iniciar-campanha`." |
| `paused` | "Essa campanha já está pausada." |
| sem campanha | "Nenhuma campanha encontrada neste canal." |

### `/retomar-campanha`

| Status atual | Comportamento |
|---|---|
| `paused` | Muda status para `active`, confirma. |
| `active` | "Essa campanha já está em andamento." |
| `draft` | "Essa campanha ainda não começou. Use `/iniciar-campanha`." |
| sem campanha | "Nenhuma campanha encontrada neste canal." |

### `message-handler.ts`

- Campanha `paused`: tratada como "sem campanha" — mensagens no canal são ignoradas silenciosamente (sem responder "está pausada" a cada mensagem de bate-papo comum).
- Campanha `draft`: comportamento já existente (roteia pra `processDraftAnswer`), só que a resposta nunca mais inclui "ainda faltam perguntas" nem ativa a campanha.
- Campanha `active`: sem mudança (laço narrativo/combate atual).

## `/criar-campanha` sem documento: lore aleatória

Hoje esse caminho ativa a campanha na hora com `defaultRulesetConfig()` e `lore` vazia. Passa a:

1. Chamar uma função nova, `generateRandomLore(claudeClient): Promise<string>` (novo módulo, ex: `src/ingestion/random-lore.ts`), que pede ao Claude um gancho de aventura curto (2-4 frases) e genérico, sem contexto de documento — cada chamada deve gerar algo diferente.
2. Criar a campanha já em `active` (sem etapa de revisão — não há nada "assumido" no ruleset pra revisar, já é 100% padrão) com essa lore.

Como isso passa a envolver uma chamada de LLM, `criar-campanha.ts` precisa de `interaction.deferReply()` nesse caminho (hoje é uma resposta síncrona/instantânea).

## `/minha-ficha`

Comando novo, sem argumentos obrigatórios:

```
/minha-ficha [publico: boolean, opcional, padrão false]
```

- Sem campanha no canal → "Nenhuma campanha encontrada neste canal."
- Campanha existe (`draft`, `active` ou `paused`), sem ficha do jogador que chamou o comando → "Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro." (na prática, em `draft` isso é sempre o caso, já que `/criar-personagem` continua exigindo `active` — sem mudança nessa trava).
- Com ficha → responde com nome, atributos, recursos e inventário (ou "vazio" se a lista de inventário estiver vazia). Funciona também com a campanha `paused` — pausar não deveria impedir o jogador de consultar a própria ficha, só suspende o processamento de turnos.
- Resposta é **efêmera** (`ephemeral: true`) por padrão — só quem pediu enxerga. Se `publico: true`, a resposta aparece pra todos no canal.

## Testes

Cobertura nova/alterada esperada:

- `extractCampaignDocument` / prompt: não precisa de teste de conteúdo do prompt (já não se testa isso hoje), mas o novo comportamento "sempre completo" é coberto indiretamente pelos testes de `draft-flow` e dos comandos.
- Rede de segurança de validação: teste garantindo que uma `rulesetConfig` inválida devolvida pela extração é substituída por `defaultRulesetConfig()` antes de salvar, sem lançar erro nem deixar a campanha travada.
- `processDraftAnswer`: teste atualizado para nunca ativar a campanha sozinho, e sempre retornar uma config válida salva via `saveDraftProgress`.
- `/iniciar-campanha`, `/pausar-campanha`, `/retomar-campanha`: um teste por combinação relevante da tabela de estados de cada comando.
- `message-handler.ts`: teste garantindo que mensagens em campanha `paused` são ignoradas (nenhuma chamada a `llmProvider.runTurn` nem a `processDraftAnswer`).
- `/criar-campanha` sem documento: teste garantindo que a lore gerada é usada e a campanha nasce `active`.
- `/minha-ficha`: testes para os casos (sem campanha, sem ficha, com ficha em `active`, com ficha em `paused`, efêmero vs. público).

## Fora de escopo (deste design)

- Botão de confirmação para ações de jogo (combate etc.) — ideia separada, registrada para um design futuro.
- Editor visual/modal para a configuração de regras — mantido como interação por texto livre, consistente com o resto do bot.
- Reenvio de um novo documento durante a revisão (a edição é só por texto, não por novo anexo).
