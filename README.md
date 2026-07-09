# RPGMaster

Um bot de Discord que atua como mestre de RPG por IA: narra a aventura, controla NPCs, gerencia fichas de personagem e conduz combate por turnos, para grupos de 3 a 5 jogadores em sessões de tempo real.

O LLM (Claude ou um modelo local via Ollama) narra e decide quando algo exige resolução mecânica; toda a matemática do jogo (dados, dano, HP, turnos) é calculada em código, nunca inventada pelo modelo. Cada campanha pode usar um sistema de regras simplificado padrão ou um sistema próprio, extraído de um documento (lore + regras caseiras) enviado pelo criador da campanha como anexo (`.txt`/`.pdf`).

Veja o design completo em [docs/superpowers/specs/2026-07-05-mestre-rpg-ia-design.md](docs/superpowers/specs/2026-07-05-mestre-rpg-ia-design.md).

## Status

Implementado em 5 planos sequenciais, cada um entregando algo testável sozinho:

- [x] **Plano 1 — Motor de regras** ([plano](docs/superpowers/plans/2026-07-05-01-motor-de-regras.md)): dados, testes de atributo, resolução de ataque/dano, iniciativa e turnos, e o schema `RulesetConfig` (validado com Zod, com um branded type `ValidatedRulesetConfig` garantido em tempo de compilação). Módulo puro, sem I/O, em `src/rules-engine/`.
- [x] **Plano 2 — Bot e persistência** ([plano](docs/superpowers/plans/2026-07-05-02-bot-e-persistencia.md)): Postgres (`campaigns`, `characters`, isolados por servidor/canal do Discord), `/criar-campanha` (ruleset padrão) e `/criar-personagem` (modal dinâmico gerado a partir dos atributos da campanha), roteador de interações, ponto de entrada e scripts de migração/registro de comandos.
- [x] **Plano 3 — Laço narrativo** ([plano](docs/superpowers/plans/2026-07-05-03-laco-narrativo.md)): mestre movido a LLM fora de combate, com abstração de provedor (`LlmProvider` — `ClaudeProvider`/`OllamaProvider` intercambiáveis via `LLM_PROVIDER`), tools `fazer_teste`/`consultar_ficha`, resumo de sessão persistido, e tratamento de falha do LLM sem deixar o jogador sem resposta.
- [x] **Plano 4 — Combate por turnos** ([plano](docs/superpowers/plans/2026-07-05-04-combate-por-turnos.md)): `/iniciar-combate` calcula iniciativa e persiste o estado de combate em Postgres; o bot recusa ações fora de turno antes de envolver o LLM, e as tools `resolver_ataque`/`aplicar_dano`/`avancar_turno` resolvem a mecânica sem o modelo nunca inventar números, com dano de jogador sempre refletido de volta na ficha. `aplicar_dano` também detecta o fim do combate (todos os combatentes de um lado com HP zerado) e limpa o estado automaticamente.
- [x] **Plano 5 — Ingestão de documento** ([plano](docs/superpowers/plans/2026-07-05-05-ingestao-de-documento.md)): `/criar-campanha` aceita um documento opcional; o Claude extrai lore e `ruleset_config` uma única vez, validando sempre com o mesmo schema do Plano 1. O fluxo de rascunho/revisão desse plano foi substituído pelo do Plano 6 abaixo.
- [x] **Plano 6 — Revisão e trava de configuração** ([design](docs/superpowers/specs/2026-07-07-revisao-e-trava-de-campanha-design.md), [plano](docs/superpowers/plans/2026-07-07-06-revisao-e-trava-de-campanha.md)): a extração de regras agora sempre devolve uma `ruleset_config` completa (inferida do documento ou preenchida com o sistema padrão, com rede de segurança se a validação falhar) — chega de perguntas em loop. A campanha nasce em `draft` com um resumo completo pra revisar/editar por texto livre no canal, e só `/iniciar-campanha` trava a configuração e começa a sessão (trava permanente, sem reabrir na pausa). `/pausar-campanha` e `/retomar-campanha` dão um recesso na sessão sem soltar a configuração. `/criar-campanha` sem documento agora gera uma lore aleatória em vez de nascer em branco. `/minha-ficha` deixa o jogador conferir a própria ficha a qualquer momento (efêmero por padrão, `publico:true` pra mostrar a todos).
- [x] **Plano 7 — Memória em 3 camadas** ([design](docs/superpowers/specs/2026-07-08-memoria-em-camadas-design.md), [plano](docs/superpowers/plans/2026-07-08-07-memoria-em-camadas.md)): memória narrativa dividida em lore fixa (Hard), estado de trama via reflexão periódica a cada 10 mensagens (Working: ritmo/marco/fatos), e buffer estruturado das últimas 5 trocas (Short-term), substituindo o antigo `session_summary` truncado por tamanho. Evolução futura: [estado canônico + retrieval](docs/superpowers/specs/2026-07-09-estado-canonico-e-retrieval-design.md) e [próximos passos](docs/superpowers/specs/2026-07-09-proximos-passos-memoria-e-prompt.md).

Com o Plano 5, o MVP descrito no design está completo; o Plano 6 refina a experiência de configuração; o Plano 7 melhora a coerência narrativa em sessões longas (especialmente com Ollama 7B).

### Pendências resolvidas após a revisão final

- Fim de combate automático (`verificarFimDeCombate` em `src/rules-engine/combat.ts`), antes um gap Minor deliberado do Plano 4.
- Id do modelo Claude centralizado em `CLAUDE_MODEL` (`src/config.ts`), removendo a duplicação de literal entre `extract.ts` e `claude-provider.ts`.
- Anexos em PDF agora são extraídos de verdade (`pdf-parse`) em vez de lidos como texto cru — antes isso derrubava a criação da campanha com um erro de encoding no Postgres sempre que o PDF continha bytes 0x00.

### Referência a Google Docs (desativada)

`src/bot/google-docs.ts` (leitura de todas as guias/sub-guias de um Google Docs via API oficial + conta de serviço, ver [design](docs/superpowers/specs/2026-07-07-google-docs-campaign-reference-design.md)/[plano](docs/superpowers/plans/2026-07-07-google-docs-campaign-reference.md)) está implementado e testado, mas **não está conectado a nenhum comando**: a opção `link` foi removida de `/criar-campanha` porque o modelo de conta de serviço exige compartilhar manualmente cada Google Docs com ela, o que o operador do bot não quer fazer a cada campanha criada. O módulo, seus testes, a dependência `google-auth-library` e `Config.googleServiceAccountKey` continuam disponíveis para religar no futuro se o modelo de compartilhamento mudar.

### Valor máximo de atributos e orçamento total de pontos

O formulário de `/criar-personagem` mostra o valor máximo permitido (18) no título de cada campo de atributo e recusa envios acima desse teto com uma mensagem clara (`MAX_ATTRIBUTE_VALUE` em `src/bot/commands/criar-personagem.ts`). O título do modal também mostra o orçamento total de pontos (30) quando cabe no limite de 45 caracteres do Discord (cai de volta pro título simples, sem truncar o nome do personagem, quando não cabe); modais do Discord não têm gancho de JS no cliente, então uma soma que atualiza em tempo real durante a digitação não é possível — a soma dos atributos só é validada depois do envio, recusando quando ultrapassa o orçamento (`MAX_ATTRIBUTE_POINTS_TOTAL`).

### Robustez e variedade na experiência de jogo

Três melhorias pequenas, levantadas ao revisar uma conversa externa de pesquisa sobre modelos locais/arquitetura ([docs/notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md](docs/notes/2026-07-07-gemini-chat-modelo-offline-e-arquitetura.md)):

- **Timeout nas chamadas ao LLM** (`LLM_REQUEST_TIMEOUT_MS` em `src/config.ts`, 30s): tanto `ClaudeProvider` quanto `OllamaProvider` agora limitam o tempo de cada requisição. Antes, se o modelo (sobretudo um Ollama local) travasse, a promise nunca resolvia e o jogador não recebia nem a mensagem de erro amigável — só ficava esperando.
- **Indicador de "digitando" no Discord**: `handleMessage` (`src/bot/message-handler.ts`) sinaliza `sendTyping()` no canal enquanto aguarda a narração do LLM, com falha de permissão silenciada (best-effort, nunca bloqueia a resposta).
- **Sementes de gênero na lore aleatória**: `generateRandomLore` (`src/ingestion/random-lore.ts`) agora sorteia um entre 5 estilos narrativos (alta fantasia, horror cósmico, cyberpunk, faroeste sombrio, piratas) a cada chamada, em vez de usar sempre o mesmo prompt genérico — evita que campanhas sem documento saiam sempre com a mesma cara.

## Stack técnica

- Node.js 20+, TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- discord.js v14
- `@anthropic-ai/sdk` (Claude) e `openai` (contra o endpoint compatível do Ollama)
- `google-auth-library` (autenticação de conta de serviço para a API do Google Docs)
- Postgres (`pg`), `pg-mem` para testes
- Zod para validação de schema
- Vitest

## Desenvolvimento

```bash
npm install
npm test          # roda a suíte de testes
npm run typecheck # checagem de tipos
```

Variáveis de ambiente: veja [.env.example](.env.example) (copie para `.env` e preencha).

### Opção 1 — tudo via Docker Compose

Sobe o Postgres e o bot juntos, aplica as migrations, registra os comandos no Discord e inicia o bot:

```bash
docker compose up --build
```

O serviço `bot` lê o `.env` (mesmo arquivo usado localmente), mas sempre aponta o Postgres para o serviço `db` da rede do Compose — não precisa editar `DATABASE_URL` para isso funcionar. O Postgres também fica exposto em `localhost:55432` no host, caso queira inspecioná-lo com outra ferramenta.

### Opção 2 — Postgres em Docker, bot local

Suba só o banco (porta `55432` no host para não colidir com outras instâncias):

```bash
docker run --name rpgmaster-db -e POSTGRES_PASSWORD=rpgmaster -e POSTGRES_DB=rpgmaster -p 55432:5432 -d postgres:16
```

E rode o bot direto com Node (útil para iterar sem rebuild de imagem):

```bash
npm run migrate            # aplica o schema no Postgres apontado por DATABASE_URL
npm run register-commands  # registra os comandos no Discord (globalmente, ou só num servidor se DISCORD_GUILD_ID estiver definido)
npm run dev                # inicia o bot
```

## Produção (VPS Hostinger)

Bot Discord + Postgres via Docker Compose — sem site/HTTP público. Guia completo: [docs/deploy-hostinger.md](docs/deploy-hostinger.md).

Resumo: instalar Docker na VPS → criar `/opt/rpgmaster/.env` **só no servidor** (o deploy não copia `.env`) → no Windows:

```powershell
.\deploy\deploy.ps1 -SshHost SEU_ALIAS_SSH -RegisterCommands
```
