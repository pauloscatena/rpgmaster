# Inventário, poderes, XP e economia — Design

> **Status:** design proposto — **não implementar** até confirmação no chat.
> **Decisão de interação (usuário):** Opção **A** — mutações de inventário e gastos de XP do jogador via **slash commands** (canônico e previsível).
> **Refino (usuário):** o **RPG Master (LLM)** pode conceder **XP** e **poderes** quando a decisão do jogador + o momento da história justificarem — e isso deve ser **difícil / raro**. Caps aprovados: **5 XP / 30 msgs / 10 grants**.
> **Refino (usuário):** economia **opcional** — se a história não tiver economia → **não mostrar** dinheiro na ficha (`economyEnabled`, default **false**). Com economia on: carteira major/minor; nomes lore → sorteio → fallback **moedas de ouro** / **moedas de prata**.
> **Bugfix no mesmo pacote:** o Master **nunca** inventa/substitui o nome do PC (ex.: ficha **Tess**, narração **Ronaldo**). Ficha aceita **nome completo**; a IA escolhe quando usar só o nome ou nome+sobrenome.
> Relacionado: [mestre-rpg-ia](2026-07-05-mestre-rpg-ia-design.md) · [memória em camadas](2026-07-08-memoria-em-camadas-design.md) · [próximos passos memória/prompt](2026-07-09-proximos-passos-memoria-e-prompt.md)

## Problema

Hoje a ficha tem `inventory: string[]` (lista de nomes), sem capacidade, sem ações, sem metadados. Não existe classe, poderes, XP nem evolução. O design original citava `atualizar_inventario` como tool do LLM, mas **essa tool nunca foi implementada**. O 7B (Ollama) tende a inventar itens/números se o estado não for canônico no Postgres e as mutações não forem feitas em código. Em teste, o modelo também **substituiu o nome do PC** (Tess → Ronaldo) porque o prompt não injeta a lista canônica de personagens.

## Objetivos

1. **Inventário** = bolsa com capacidade expansível; itens com metadados mínimos; ações: usar, ler, dar, jogar fora.
2. **Poderes** = ligados à **classe**; nível **1–10**; sobem com **XP**.
3. **XP / evolução** = gate `evolutionEnabled`; curva crescente; Master concede XP/poder de forma **rara** (5/30/10).
4. **Economia opcional** = `economyEnabled` (default false); se off, **zero** dinheiro na UI; se on, carteira + nomes de moeda.
5. **Nome canônico do PC** = ficha com nome completo + forma curta; prompt lista ambos; Master nunca inventa/substitui; prosa usa short vs full conforme a cena.
6. **7B-safe** = mutações só via slash/tools validadas; LLM não inventa itens/saldo/XP/poder/nomes de PC.

## Fora de escopo (v1)

- Crafting, equipamento, loja com catálogo de preços, bancos/dívidas.
- Loot automático de **itens** pelo LLM (só organizador).
- Master evoluindo nível de poder (2–10) ou atributos diretamente.
- Embeddings / Opção C; snapshot completo de ficha no prompt (além do bloco de nomes).

---

## O que já existe vs o que falta

| Área | Hoje | Falta |
|------|------|--------|
| Inventário | `string[]` | Objetos, bolsa, slash |
| Poderes / XP / classe | — | Ruleset + ficha + slash + tools raras |
| Economia | — | `economyEnabled` + wallet + nomes |
| Nome do PC no prompt | Só indireto (short-term) | Bloco canônico + hard rule |
| Tools LLM | `consultar_ficha`, testes, combate | XP/poder (raro), carteira (se economia on) |

---

## Decisão de interação

### Jogador (Opção A)

Slash para inventário e gastos de XP. Dinheiro (`/carteira`, `/pagar`, `/dar-dinheiro`) **só** se `economyEnabled`.

### Organizador

`/conceder-item`, `/conceder-xp`, `/definir-capacidade-bolsa`; `/conceder-dinheiro` só se economia on. Auth: `createdByDiscordId` ou Admin/ManageGuild.

### RPG Master

- **XP/poder (raro):** `conceder_xp` / `conceder_poder` — caps 5 / 30 msgs / 10 grants.
- **Dinheiro:** `ajustar_carteira` **somente** se `economyEnabled` (sem cooldown de XP; caps 50/99).
- **Itens:** nunca via LLM.
- **Nomes:** nunca inventar/substituir nome de PC da ficha.

---

## Approaches (resumo)

| Tema | Escolha |
|------|---------|
| Mutação jogador | Slash (A) |
| XP/poder história | Tools Master raras + organizador (A4) |
| Itens | Só organizador |
| Economia | E1 bimetálico 1:10 + gate `economyEnabled` (default false) |
| Catálogo poderes | No `ruleset_config` (B1) |

---

## Gate `economyEnabled`

Flag na campanha: `campaigns.economy_enabled` (boolean), definida na criação, **travada** após `/iniciar-campanha`.

| Fonte | Valor |
|-------|--------|
| Default / ambíguo / sem documento | **`false`** |
| Lore com comércio, moedas, preços, mercadores, salário | **`true`** |
| Lore sem indício de economia | **`false`** |

**Quando `false`:**

- `/minha-ficha`, `/inventario`, `consultar_ficha`: **omitir** saldo/moeda (nem “0 ouro”).
- Slash `/carteira`, `/pagar`, `/dar-dinheiro`, `/conceder-dinheiro`: *“Esta campanha não usa economia.”*
- Tool `ajustar_carteira` **fora** da lista do turno.
- Prompt: **sem** linha de moedas; não narrar pagamentos mecânicos com saldo.
- Colunas wallet no DB podem existir (0); UI/tools ignoram.

**Quando `true`:** saldo visível; nomes de moeda; slash + tool de carteira ativos.

---

## Nome canônico do personagem (bugfix Tess → Ronaldo + nome/sobrenome)

### Causa

`buildSystemPrompt` hoje **não** recebe o nome do PC atuante nem a lista de PCs da campanha. O 7B inventa um nome genérico na prosa. Jogadores também querem **nome e sobrenome** na ficha, com a IA sabendo quando usar a forma curta vs a completa.

### Schema da ficha (escolhido — YAGNI)

| Opção | Ideia | Veredito |
|-------|--------|----------|
| A | Só `name` livre + parse do 1º token | Frágil (nomes compostos, partículas) |
| B | `givenName` + `familyName` obrigatório/opcional | Mais campos no modal Discord |
| **C (escolhida)** | `name` = completo obrigatório; `shortName` opcional | Simples; default = 1º token |

```ts
// CharacterSheet:
name: string;       // completo, ex. "Tess Nightshade" ou só "Tess"
shortName: string;  // forma curta na prosa; se omitido na criação → primeiro token de name
```

- Persistência: coluna `short_name TEXT` (ou campo no JSON da ficha). Migração: `short_name = split_first_token(name)`.
- Helper puro: `defaultShortName(fullName: string): string` — primeiro segmento por espaço; se vazio, usa `fullName`.
- `/criar-personagem`: opção `nome` aceita string completa (ex. `Tess Nightshade`). `shortName` **não** é pedido no modal v1 (sempre derivado); organizador pode ter `/definir-apelido` na v1.1 — **fora** do MVP.
- Validação: `name` trim, 1–80 chars; `shortName` trim, 1–40 chars, deve ser substring “razoável” do name **ou** igual ao primeiro token (não exigir igualdade estrita além do default).
- **Nunca** inventar sobrenome: se `name === shortName` (só um token), a IA não inventa família.

### Prompt canônico

1. **Hard rules:**
   - Use **somente** os nomes canônicos listados (completo e forma curta).
   - **Nunca** invente, traduza, substitua ou invente sobrenome ausente na ficha.
   - Nunca chame o PC por outro nome (ex.: Tess → Ronaldo).

2. **Regra narrativa (hard rules curtas no prompt):**
   - Na prosa **casual** (ação corrida, diálogo do dia a dia): preferir a **forma curta** (`shortName`).
   - Usar **nome completo** (`name`) quando: primeira apresentação na cena; momento formal; documentos/registros; NPC desconhecido se referindo ao PC; ênfase dramática; **ambiguidade** entre dois PCs com o mesmo shortName.
   - Se não houver sobrenome na ficha (`name` == um único token / igual a `shortName`): usar só esse nome; **não** inventar sobrenome.

3. **Injeção** em `buildSystemPrompt` (a cada turno):

```ts
partyCharacters: { name: string; shortName: string }[];
actingCharacterName: string;      // completo
actingCharacterShortName: string; // curto
```

Exemplo de bloco:

```
Personagens jogadores nesta campanha (nomes canônicos):
- Completo: "Tess Nightshade" | Forma curta: "Tess"
- Completo: "Aria Vale" | Forma curta: "Aria"

O personagem do jogador nesta mensagem é: Tess Nightshade. Forma curta: Tess.
Prefira a forma curta na prosa casual; use o nome completo em apresentações, formalidade, documentos, ênfase ou ambiguidade.
Nunca o chame por outro nome. Nunca invente sobrenome.
```

4. **Wiring:** `message-handler` passa `character.sheet.name` / `shortName` e a party via `getCharactersByCampaign`.

5. **Anti-meta:** se o modelo errar, não explicar o bug na prosa. Sem pós-processamento de rename na v1.

6. **Testes:** prompt contém completo + forma curta do atuante, lista da party, hard rules de short vs full e anti-invenção; `defaultShortName('Tess Nightshade') === 'Tess'`.

7. **Fora de escopo v1:** autocorreção da narração; rename/apelido via slash; partículas de sobrenome sofisticadas.

---

## Design de dados

### Item

```ts
interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  description: string;
  usable: boolean;
  readable: boolean;
}
```

Migração: `string[]` → objetos `{ id, name, qty: 1, description: '', usable: true, readable: false }`.

### Bolsa

`bag_capacity` default 10; slots = soma de `qty`. Expansão: `/definir-capacidade-bolsa` (organizador).

### Classe, poderes, XP

```ts
interface CharacterPower { powerKey: string; level: number } // 1..10
// ficha: classKey, xp, powers, lastMasterGrantAtCampaignMessages
```

### Carteira

```ts
interface Wallet { major: number; minor: number } // >= 0
export const MINOR_PER_MAJOR = 10;
```

Persistida sempre; **só UI/mutação** se `economyEnabled`. Não ocupa slot da bolsa. Novo PC: `{0,0}`.

### Moedas e campanha

```ts
interface CurrencyNames { major: string; minor: string }

// campaigns:
economyEnabled: boolean;          // default false
currencyNames: CurrencyNames;     // placeholder ouro/prata se economia off
createdByDiscordId: string | null;
campaignMessageCount: number;
masterGrantLog: MasterGrantLogEntry[]; // type: 'xp' | 'power' | 'wallet'
```

**Nomes (só relevantes se economia on):** lore clara → senão sorteio de lista curta → senão `{ major: "moedas de ouro", minor: "moedas de prata" }`. Se economia off: gravar fallback; nunca mostrar.

### Ruleset

```ts
// RulesetConfig +:
classes: ClassDef[];
powers: PowerDef[];
evolutionEnabled: boolean; // default true se ambíguo
```

`economyEnabled` / `currencyNames` na **campanha**, não no ruleset de combate.

---

## XP (gastos e concessão)

**Gastos (jogador):** `powerLevelCost(L)=10*L`; `attributeBumpCost=5*max(1,current)`; `learnPowerCost=15`.

**Master (raro):**

| Constante | Valor |
|-----------|--------|
| `MAX_XP_PER_MASTER_GRANT` | 5 |
| `MASTER_GRANT_COOLDOWN_MESSAGES` | 30 |
| `MAX_MASTER_GRANTS_PER_CHARACTER` | 10 |

Tools: `conceder_xp` `{ amount, reason }`, `conceder_poder` `{ powerKey, reason }` → poder nível 1, classe ok, reason ≥ 8 chars. Organizador `/conceder-xp` ignora cooldown/cap.

---

## Carteira (se `economyEnabled`)

Tool `ajustar_carteira` `{ majorDelta, minorDelta, reason }` — caps abs 50 / 99; saldo ≥ 0; sem cooldown XP.

Slash: `/carteira`, `/pagar`, `/dar-dinheiro`, `/conceder-dinheiro`.

---

## Slash commands

| Comando | Quem | Nota |
|---------|------|------|
| `/inventario` | jogador | Saldo **só** se economia on |
| `/carteira` `/pagar` `/dar-dinheiro` | jogador | Gate economia |
| `/usar` `/ler` `/dar` `/jogar-fora` | jogador | Itens |
| `/poderes` `/aprender-poder` `/evoluir-poder` `/evoluir-atributo` `/definir-classe` | jogador | XP |
| `/conceder-item` `/conceder-xp` `/definir-capacidade-bolsa` | organizador | — |
| `/conceder-dinheiro` | organizador | Gate economia |
| `/minha-ficha` | jogador | Sem linha de dinheiro se economia off |

`/usar` v1: só consome se `usable` (sem heal automático).

---

## Integração LLM / prompt

`buildSystemPrompt` ganha:

- `actingCharacterName`, `actingCharacterShortName`, `partyCharacters: { name, shortName }[]`
- `economyEnabled`, `currencyNames` (linha de moedas **só** se economia on)
- Hard rules: XP/poder raros; nunca inventar itens; nomes canônicos (short vs full); carteira só via tool se economia on

`message-handler`: incrementa `campaignMessageCount`; registra tools conforme gates; passa party + nome/short do atuante.

---

## Defaults

- Classes: `guerreiro`, `arcanista`, `sombra` (2 poderes cada).
- `evolutionEnabled: true`; `economyEnabled: false`.
- Bolsa 10; wallet 0/0; xp 0; powers []; classKey null.

---

## Testes (mínimo)

- Inventário, XP, wallet, master grants 5/30/10.
- `economyEnabled false`: ficha/inventário/consultar_ficha **sem** dinheiro; slash/tool recusam.
- `economyEnabled true`: saldo + nomes + pagar/ajustar.
- **Prompt:** contém nome completo + shortName do atuante e da party; regras short vs full; anti-invenção de nome/sobrenome.
- `defaultShortName` e criação com nome completo.
- Prompt com/sem linha de moedas conforme flag.

---

## Critérios de pronto (v1)

- [ ] Inventário + slash itens
- [ ] `economyEnabled` default false; sem dinheiro na UI quando false
- [ ] Economia on: carteira, nomes, slash, `ajustar_carteira`
- [ ] Classe/poderes/XP + Master 5/30/10 + organizador
- [ ] Nome completo + shortName na ficha; prompt canônico (short vs full) + testes
- [ ] Hard rules; sem tool de item no LLM
- [ ] `/minha-ficha` / `consultar_ficha` corretos

## Self-review

- Gate economia e bugfix de nome estão especificados com wiring concreto.
- Caps XP 5/30/10 intactos.
- Sem implementação até confirmação do usuário.
