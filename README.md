# RPGMaster

Um bot de Discord que atua como mestre de RPG por IA: narra a aventura, controla NPCs, gerencia fichas de personagem e conduz combate por turnos, para grupos de 3 a 5 jogadores em sessões de tempo real.

O LLM (Claude ou um modelo local via Ollama) narra e decide quando algo exige resolução mecânica; toda a matemática do jogo (dados, dano, HP, turnos) é calculada em código, nunca inventada pelo modelo. Cada campanha pode usar um sistema de regras simplificado padrão ou um sistema próprio, extraído de um documento (lore + regras caseiras) enviado pelo criador da campanha.

Veja o design completo em [docs/superpowers/specs/2026-07-05-mestre-rpg-ia-design.md](docs/superpowers/specs/2026-07-05-mestre-rpg-ia-design.md).

## Status

Implementado em 5 planos sequenciais, cada um entregando algo testável sozinho:

- [x] **Plano 1 — Motor de regras** ([plano](docs/superpowers/plans/2026-07-05-01-motor-de-regras.md)): dados, testes de atributo, resolução de ataque/dano, iniciativa e turnos, e o schema `RulesetConfig` (validado com Zod, com um branded type `ValidatedRulesetConfig` garantido em tempo de compilação). Módulo puro, sem I/O, em `src/rules-engine/`.
- [x] **Plano 2 — Bot e persistência** ([plano](docs/superpowers/plans/2026-07-05-02-bot-e-persistencia.md)): Postgres (`campaigns`, `characters`, isolados por servidor/canal do Discord), `/criar-campanha` (ruleset padrão) e `/criar-personagem` (modal dinâmico gerado a partir dos atributos da campanha), roteador de interações, ponto de entrada e scripts de migração/registro de comandos.
- [x] **Plano 3 — Laço narrativo** ([plano](docs/superpowers/plans/2026-07-05-03-laco-narrativo.md)): mestre movido a LLM fora de combate, com abstração de provedor (`LlmProvider` — `ClaudeProvider`/`OllamaProvider` intercambiáveis via `LLM_PROVIDER`), tools `fazer_teste`/`consultar_ficha`, resumo de sessão persistido, e tratamento de falha do LLM sem deixar o jogador sem resposta.
- [ ] **Plano 4 — Combate por turnos** ([plano](docs/superpowers/plans/2026-07-05-04-combate-por-turnos.md)): iniciativa, enforcement de turno, `/iniciar-combate`.
- [ ] **Plano 5 — Ingestão de documento** ([plano](docs/superpowers/plans/2026-07-05-05-ingestao-de-documento.md)): upload de campanha, extração de lore + regras via LLM, `/responder-campanha`.

## Stack técnica

- Node.js 20+, TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- discord.js v14
- `@anthropic-ai/sdk` (Claude) e `openai` (contra o endpoint compatível do Ollama)
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

Para rodar o bot contra um Postgres e uma aplicação Discord reais:

```bash
npm run migrate            # aplica o schema no Postgres apontado por DATABASE_URL
npm run register-commands  # registra /criar-campanha e /criar-personagem no Discord
npm run dev                # inicia o bot
```
