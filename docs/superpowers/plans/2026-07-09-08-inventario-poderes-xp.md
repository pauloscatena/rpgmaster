# Inventário, Poderes, XP, Economia e Nome Canônico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Não executar** até o usuário confirmar a [design spec](../specs/2026-07-09-inventario-poderes-xp-design.md).

**Goal:** Inventário + poderes/XP; Master concede XP/poder raro (5/30/10); economia opcional (`economyEnabled` default false); carteira major/minor; **bugfix nomes:** ficha com `name` completo + `shortName`; prompt injeta ambos e regras short vs full (nunca Tess→Ronaldo; nunca inventar sobrenome).

**Architecture:** Motor puro (`inventory`, `evolution`, `wallet`, `master-grants`, `defaultShortName`). Campanha: `economy_enabled`, `currency_names`, contadores, log. Jogador: slash. Master: tools XP/poder (+ `ajustar_carteira` só se economia on). `buildSystemPrompt` recebe party `{name, shortName}` + atuante.

**Tech Stack:** Node.js 20+, TypeScript, discord.js v14, `pg`, Zod, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-inventario-poderes-xp-design.md`.
- XP Master: 5 / 30 msgs / 10 grants (**não alterar**).
- `economyEnabled` default **false**; off = omitir wallet na UI; slash/tools de dinheiro recusam; tool carteira ausente.
- Carteira (se on): `MINOR_PER_MAJOR=10`; caps adjust 50/99; sem cooldown XP.
- Moedas (se on): lore → sorteio → `"moedas de ouro"` / `"moedas de prata"`.
- Nome: `name` completo + `shortName` (default 1º token); prompt lista ambos; prosa casual → short; formal/apresentação/ambiguidade → full; nunca inventar/substituir nome ou sobrenome.
- Itens: sem tool LLM. `/usar` só consome. Ruleset/economia travados após `/iniciar-campanha`.

---

## Estrutura de arquivos

```
src/
  db/migrations/005_inventario_poderes_xp.sql
  db/characters-repo.ts
  db/campaigns-repo.ts
  rules-engine/types.ts
  rules-engine/ruleset-config.ts
  rules-engine/inventory.ts
  rules-engine/evolution.ts
  rules-engine/wallet.ts
  rules-engine/currency-names.ts
  rules-engine/master-grants.ts
  rules-engine/character.ts
  rules-engine/index.ts
  llm/tools.ts
  llm/master-grant-tools.ts
  rules-engine/character-names.ts        # CRIAR: defaultShortName
  llm/context.ts                         # party name/shortName + economy
  bot/message-handler.ts                 # passar party/nome; tools condicionais
  bot/commands/criar-personagem.ts       # nome completo → shortName derivado
  bot/commands/...
tests/
  rules-engine/*.test.ts
  rules-engine/character-names.test.ts
  llm/context.test.ts                    # nome canônico short/full + economia
  llm/master-grant-tools.test.ts
  bot/commands/*.test.ts
```

---

### Task 1: Tipos, ruleset, economia, migração

**Produces:** inventário objeto; wallet; `economyEnabled` + `currencyNames`; `short_name` no character; classes/powers/`evolutionEnabled`; contadores/log; `createdByDiscordId`.

- [ ] Testes Zod + defaults (`economyEnabled` false no create sem lore).
- [ ] Schema + `pickCurrencyNames` + fallback ouro/prata.
- [ ] SQL: colunas personagem/campanha incl. `short_name`; migrar inventário legado; `short_name` = 1º token de `name`.
- [ ] Repos; `/criar-campanha` grava economia/moedas/`created_by`; sheet com `shortName`.

---

### Task 2: Motor inventário (puro)

- [ ] Testes + `usedSlots` / `addItem` / `removeItem` / `transferItem` / `findItem`.

---

### Task 3: Motor evolução / XP (puro)

- [ ] Testes + custos + spend learn/evolve.

---

### Task 4: Motor carteira (puro)

- [ ] `normalizeWallet`, `applyWalletDelta`, `formatWallet`, `MINOR_PER_MAJOR=10`.
- [ ] Testes normalizar/debitar/negativo/format.

---

### Task 5: Helpers Master XP/poder (puro)

- [ ] Constantes 5/30/10 + `canMasterGrant` + `validateMasterXpAmount` (**números fixos**).

---

### Task 6: Persistência

- [ ] Updates inventory/xp/powers/class/bag/wallet; message count; grant log.

---

### Task 7: Nome completo + shortName + prompt canônico (bugfix Tess→Ronaldo)

**Files:** `src/rules-engine/character-names.ts`, `src/llm/context.ts`, `src/bot/message-handler.ts`, `src/bot/commands/criar-personagem.ts`, testes.

**Interfaces:**

```ts
export function defaultShortName(fullName: string): string;

export function buildSystemPrompt(params: {
  // ...existentes
  actingCharacterName: string;
  actingCharacterShortName: string;
  partyCharacters: { name: string; shortName: string }[];
  economyEnabled: boolean;
  currencyNames: { major: string; minor: string };
}): string;
```

- [ ] **Step 1:** Testes `defaultShortName('Tess Nightshade') === 'Tess'`; nome só `'Tess'` → `'Tess'`.
- [ ] **Step 2:** Teste falhando do prompt com atuante `Tess Nightshade` / short `Tess` e party com Aria:
  - contém `O personagem do jogador nesta mensagem é: Tess Nightshade`
  - contém `Forma curta: Tess`
  - lista completo + forma curta de cada PC
  - hard rules: preferir short na prosa casual; full em formal/apresentação/ambiguidade; nunca inventar/substituir nome nem sobrenome
- [ ] **Step 3:** Implementar `defaultShortName` + hard rules + bloco canônico em `buildSystemPrompt`.
- [ ] **Step 4:** `/criar-personagem` grava `name` completo e `shortName = defaultShortName(name)`.
- [ ] **Step 5:** `message-handler` passa party `{name, shortName}`, atuante, `economyEnabled` / `currencyNames`.
- [ ] **Step 6:** Linha de moedas no prompt **somente** se `economyEnabled`.
- [ ] **Step 7:** Testes passam.

---

### Task 8: Slash — inventário

- [ ] `/inventario` sem linha de saldo se `!economyEnabled`.
- [ ] usar/ler/dar/jogar-fora.

---

### Task 9: Slash — carteira (gate economia)

- [ ] `/carteira` `/pagar` `/dar-dinheiro`: se off → “Esta campanha não usa economia.”
- [ ] Se on: pagar/transferir com saldo.

---

### Task 10: Slash — poderes / classe / evolução

- [ ] aprender/evoluir + `evolutionEnabled`.

---

### Task 11: Slash — organizador

- [ ] item/xp/capacidade; `/conceder-dinheiro` gate economia.

---

### Task 12: Tools LLM

- [ ] `conceder_xp` / `conceder_poder` (5/30/10).
- [ ] `ajustar_carteira` **só** se `economyEnabled` (na lista do turno).
- [ ] Sem tool de item; incrementar `campaignMessageCount`.

---

### Task 13: Ficha e consultar_ficha

- [ ] `/minha-ficha` e `consultar_ficha`: wallet **omitido** se `!economyEnabled` (nem zero).
- [ ] Personagem novo: defaults da spec.

---

### Task 14: Verificação final

- [ ] Suite Vitest; checklist da spec; sem deploy/commit sem pedido.

---

## Spec coverage

| Spec | Task |
|------|------|
| Inventário / bolsa | 1, 2, 8 |
| `economyEnabled` gate + UI | 1, 7, 8, 9, 11, 12, 13 |
| Carteira / nomes | 1, 4, 9, 11, 12 |
| XP / poderes / Master 5/30/10 | 3, 5, 10, 12 |
| **Nome completo + short vs full (bugfix)** | **7** |
| Prompt economia on/off | 7 |
| Sem loot LLM | 12 |
