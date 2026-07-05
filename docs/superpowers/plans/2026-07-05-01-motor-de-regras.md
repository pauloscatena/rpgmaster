# Motor de Regras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o motor de regras puro (sem I/O) que resolve dados, testes, ataques, dano e turnos de combate a partir de um `RulesetConfig` configurável por campanha.

**Architecture:** Módulo TypeScript independente em `src/rules-engine/`, sem dependência de Discord, Postgres ou LLM. Toda aleatoriedade é injetada via um parâmetro `Rng` (default `Math.random`) para permitir testes determinísticos. `RulesetConfig` é validado com Zod e é a única fonte de configuração de mecânica por campanha (nenhuma fórmula é interpretada pelo LLM em tempo de jogo).

**Tech Stack:** Node.js 20+, TypeScript, Vitest, Zod.

## Global Constraints

- Projeto usa Node.js 20+ e TypeScript com `strict: true`.
- Testes rodam com Vitest (`npm test` executa `vitest run`).
- O motor de regras não faz I/O (sem `fetch`, sem banco, sem Discord) — 100% funções puras.
- Toda função que envolve aleatoriedade recebe um parâmetro `rng: Rng` opcional (default `Math.random`), para permitir seeds determinísticas em teste.
- `RulesetConfig` é validado com Zod antes de ser usado; nenhuma mutação de estado de jogo é aplicada com uma config não validada.
- Restrição de escopo do MVP: `RulesetConfig.attributes` aceita no máximo 5 atributos (limite da UI de criação de ficha via modal do Discord, implementada no plano seguinte). Isso vale tanto para o config padrão quanto para configs extraídos de documento.

---

## Estrutura de arquivos

```
RPGMaster/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    rules-engine/
      types.ts            # Rng, DieSize, ResourceDef, RulesetConfig, CharacterSheet
      dice.ts              # rollDie
      ruleset-config.ts    # RulesetConfigSchema, validateRulesetConfig, defaultRulesetConfig
      character.ts         # createCharacterSheet
      checks.ts            # fazerTeste, CheckResult
      combat.ts            # resolverAtaque, aplicarDano, AttackResult
      turn.ts              # calcularIniciativa, avancarTurno, turnoAtual, CombatState, Combatant
      index.ts             # barrel export — API pública do módulo
  tests/
    rules-engine/
      dice.test.ts
      ruleset-config.test.ts
      character.test.ts
      checks.test.ts
      combat.test.ts
      turn.test.ts
```

---

### Task 1: Scaffolding do projeto + rolagem de dado

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/rules-engine/types.ts`
- Create: `src/rules-engine/dice.ts`
- Test: `tests/rules-engine/dice.test.ts`

**Interfaces:**
- Produces: `type Rng = () => number` (retorna número em `[0, 1)`); `type DieSize = 4 | 6 | 8 | 10 | 12 | 20 | 100`; `function rollDie(sides: DieSize, rng?: Rng): number`.

- [ ] **Step 1: Criar arquivos de configuração do projeto**

`package.json`:
```json
{
  "name": "rpg-master",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "pg": "^8.13.1",
    "@anthropic-ai/sdk": "^0.32.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4",
    "tsx": "^4.19.2",
    "pg-mem": "^3.0.4",
    "@types/node": "^22.9.0",
    "@types/pg": "^8.11.10"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

Run: `npm install`
Expected: dependencies instaladas sem erro, gera `package-lock.json`.

- [ ] **Step 2: Escrever teste falho para `rollDie`**

`tests/rules-engine/dice.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rollDie } from '../../src/rules-engine/dice';

describe('rollDie', () => {
  it('retorna 1 quando rng retorna 0', () => {
    expect(rollDie(20, () => 0)).toBe(1);
  });

  it('retorna o valor máximo quando rng retorna quase 1', () => {
    expect(rollDie(6, () => 0.999999)).toBe(6);
  });

  it('usa Math.random por padrão e fica dentro do intervalo', () => {
    const result = rollDie(20);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/rules-engine/dice.test.ts`
Expected: FAIL — `Cannot find module '../../src/rules-engine/dice'`.

- [ ] **Step 4: Implementar `types.ts` e `dice.ts`**

`src/rules-engine/types.ts`:
```ts
export type Rng = () => number;

export type DieSize = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface ResourceDef {
  key: string;
  label: string;
  startingValue: number;
  linkedAttribute?: string;
}

export interface RulesetConfig {
  name: string;
  attributes: string[];
  testDie: DieSize;
  resources: ResourceDef[];
  hpResourceKey: string;
  attackAttribute: string;
  damageDie: DieSize;
  defenseValue: number;
}

export interface CharacterSheet {
  name: string;
  attributes: Record<string, number>;
  resources: Record<string, number>;
  inventory: string[];
}
```

`src/rules-engine/dice.ts`:
```ts
import type { DieSize, Rng } from './types';

export function rollDie(sides: DieSize, rng: Rng = Math.random): number {
  return Math.floor(rng() * sides) + 1;
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/rules-engine/dice.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/rules-engine/types.ts src/rules-engine/dice.ts tests/rules-engine/dice.test.ts package-lock.json
git commit -m "feat: scaffold project and add die rolling"
```

---

### Task 2: `RulesetConfig` — schema Zod, validação e config padrão

**Files:**
- Create: `src/rules-engine/ruleset-config.ts`
- Test: `tests/rules-engine/ruleset-config.test.ts`

**Interfaces:**
- Consumes: `RulesetConfig`, `ResourceDef`, `DieSize` de `src/rules-engine/types.ts` (Task 1).
- Produces: `function validateRulesetConfig(data: unknown): { success: true; data: RulesetConfig } | { success: false; error: import('zod').ZodError }`; `function defaultRulesetConfig(): RulesetConfig`.

- [ ] **Step 1: Escrever testes falhos**

`tests/rules-engine/ruleset-config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateRulesetConfig, defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('defaultRulesetConfig', () => {
  it('é válido segundo o próprio schema', () => {
    const result = validateRulesetConfig(defaultRulesetConfig());
    expect(result.success).toBe(true);
  });
});

describe('validateRulesetConfig', () => {
  const base = defaultRulesetConfig();

  it('aceita uma config válida', () => {
    const result = validateRulesetConfig(base);
    expect(result.success).toBe(true);
  });

  it('rejeita mais de 5 atributos', () => {
    const invalid = { ...base, attributes: ['a', 'b', 'c', 'd', 'e', 'f'] };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando attackAttribute não está na lista de atributos', () => {
    const invalid = { ...base, attackAttribute: 'nao-existe' };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando hpResourceKey não corresponde a nenhum recurso', () => {
    const invalid = { ...base, hpResourceKey: 'nao-existe' };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita quando linkedAttribute de um recurso não está na lista de atributos', () => {
    const invalid = {
      ...base,
      resources: [{ key: 'hp', label: 'Pontos de Vida', startingValue: 10, linkedAttribute: 'nao-existe' }],
    };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });

  it('rejeita testDie fora dos valores permitidos', () => {
    const invalid = { ...base, testDie: 7 };
    const result = validateRulesetConfig(invalid);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/ruleset-config.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `ruleset-config.ts`**

`src/rules-engine/ruleset-config.ts`:
```ts
import { z } from 'zod';
import type { RulesetConfig } from './types';

const DieSizeSchema = z.union([
  z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(20), z.literal(100),
]);

const ResourceDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  startingValue: z.number().int(),
  linkedAttribute: z.string().optional(),
});

export const RulesetConfigSchema = z
  .object({
    name: z.string().min(1),
    attributes: z.array(z.string().min(1)).min(1).max(5),
    testDie: DieSizeSchema,
    resources: z.array(ResourceDefSchema).min(1),
    hpResourceKey: z.string().min(1),
    attackAttribute: z.string().min(1),
    damageDie: DieSizeSchema,
    defenseValue: z.number().int(),
  })
  .superRefine((config, ctx) => {
    if (!config.attributes.includes(config.attackAttribute)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `attackAttribute "${config.attackAttribute}" precisa estar em attributes`,
        path: ['attackAttribute'],
      });
    }
    if (!config.resources.some((r) => r.key === config.hpResourceKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `hpResourceKey "${config.hpResourceKey}" precisa corresponder a um resource.key`,
        path: ['hpResourceKey'],
      });
    }
    config.resources.forEach((r, i) => {
      if (r.linkedAttribute && !config.attributes.includes(r.linkedAttribute)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `resource "${r.key}" linkedAttribute "${r.linkedAttribute}" precisa estar em attributes`,
          path: ['resources', i, 'linkedAttribute'],
        });
      }
    });
  });

export function validateRulesetConfig(
  data: unknown
): { success: true; data: RulesetConfig } | { success: false; error: z.ZodError } {
  const result = RulesetConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as RulesetConfig };
  }
  return { success: false, error: result.error };
}

export function defaultRulesetConfig(): RulesetConfig {
  return {
    name: 'Sistema Simplificado Padrão',
    attributes: ['forca', 'destreza', 'intelecto'],
    testDie: 20,
    resources: [{ key: 'hp', label: 'Pontos de Vida', startingValue: 10, linkedAttribute: 'forca' }],
    hpResourceKey: 'hp',
    attackAttribute: 'forca',
    damageDie: 6,
    defenseValue: 12,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/rules-engine/ruleset-config.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules-engine/ruleset-config.ts tests/rules-engine/ruleset-config.test.ts
git commit -m "feat: add ruleset config schema, validation and default config"
```

---

### Task 3: Ficha de personagem — `createCharacterSheet`

**Files:**
- Create: `src/rules-engine/character.ts`
- Test: `tests/rules-engine/character.test.ts`

**Interfaces:**
- Consumes: `RulesetConfig`, `CharacterSheet` de `types.ts`; `defaultRulesetConfig` de `ruleset-config.ts` (Task 2).
- Produces: `function createCharacterSheet(config: RulesetConfig, name: string, attributeValues: Record<string, number>): CharacterSheet`.

- [ ] **Step 1: Escrever testes falhos**

`tests/rules-engine/character.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('createCharacterSheet', () => {
  const config = defaultRulesetConfig();

  it('cria a ficha com atributos e nome corretos', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.name).toBe('Aria');
    expect(sheet.attributes).toEqual({ forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.inventory).toEqual([]);
  });

  it('calcula o recurso vinculado somando o atributo ao valor inicial', () => {
    const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
    expect(sheet.resources.hp).toBe(13); // startingValue 10 + forca 3
  });

  it('lança erro se faltar valor de algum atributo', () => {
    expect(() => createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2 })).toThrow(
      /intelecto/
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/character.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `character.ts`**

`src/rules-engine/character.ts`:
```ts
import type { CharacterSheet, RulesetConfig } from './types';

export function createCharacterSheet(
  config: RulesetConfig,
  name: string,
  attributeValues: Record<string, number>
): CharacterSheet {
  for (const attr of config.attributes) {
    if (!(attr in attributeValues)) {
      throw new Error(`Falta valor para o atributo "${attr}"`);
    }
  }

  const resources: Record<string, number> = {};
  for (const resource of config.resources) {
    const bonus = resource.linkedAttribute ? attributeValues[resource.linkedAttribute] : 0;
    resources[resource.key] = resource.startingValue + bonus;
  }

  return {
    name,
    attributes: { ...attributeValues },
    resources,
    inventory: [],
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/rules-engine/character.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules-engine/character.ts tests/rules-engine/character.test.ts
git commit -m "feat: add character sheet creation"
```

---

### Task 4: Resolução de teste — `fazerTeste`

**Files:**
- Create: `src/rules-engine/checks.ts`
- Test: `tests/rules-engine/checks.test.ts`

**Interfaces:**
- Consumes: `RulesetConfig`, `CharacterSheet` de `types.ts`; `rollDie` de `dice.ts` (Task 1); `defaultRulesetConfig`, `createCharacterSheet` para setup de teste.
- Produces: `interface CheckResult { roll: number; attributeValue: number; total: number; difficulty: number; success: boolean }`; `function fazerTeste(config: RulesetConfig, character: CharacterSheet, attribute: string, difficulty: number, rng?: Rng): CheckResult`.

- [ ] **Step 1: Escrever testes falhos**

`tests/rules-engine/checks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fazerTeste } from '../../src/rules-engine/checks';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('fazerTeste', () => {
  const config = defaultRulesetConfig();
  const character = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });

  it('soma a rolagem ao valor do atributo', () => {
    const result = fazerTeste(config, character, 'forca', 10, () => 0.5); // d20 com rng=0.5 -> roll 11
    expect(result.roll).toBe(11);
    expect(result.attributeValue).toBe(3);
    expect(result.total).toBe(14);
  });

  it('marca sucesso quando total >= dificuldade', () => {
    const result = fazerTeste(config, character, 'forca', 14, () => 0.5);
    expect(result.success).toBe(true);
  });

  it('marca falha quando total < dificuldade', () => {
    const result = fazerTeste(config, character, 'forca', 15, () => 0.5);
    expect(result.success).toBe(false);
  });

  it('lança erro se o atributo não existir na ficha', () => {
    expect(() => fazerTeste(config, character, 'carisma', 10, () => 0.5)).toThrow(/carisma/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/checks.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `checks.ts`**

`src/rules-engine/checks.ts`:
```ts
import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

export interface CheckResult {
  roll: number;
  attributeValue: number;
  total: number;
  difficulty: number;
  success: boolean;
}

export function fazerTeste(
  config: RulesetConfig,
  character: CharacterSheet,
  attribute: string,
  difficulty: number,
  rng: Rng = Math.random
): CheckResult {
  if (!(attribute in character.attributes)) {
    throw new Error(`A ficha de "${character.name}" não tem o atributo "${attribute}"`);
  }
  const roll = rollDie(config.testDie, rng);
  const attributeValue = character.attributes[attribute];
  const total = roll + attributeValue;
  return { roll, attributeValue, total, difficulty, success: total >= difficulty };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/rules-engine/checks.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules-engine/checks.ts tests/rules-engine/checks.test.ts
git commit -m "feat: add check resolution"
```

---

### Task 5: Combate — `resolverAtaque` e `aplicarDano`

**Files:**
- Create: `src/rules-engine/combat.ts`
- Test: `tests/rules-engine/combat.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `fazerTeste` de `checks.ts` (Task 4); `rollDie` de `dice.ts`; `CharacterSheet`, `RulesetConfig`, `Rng` de `types.ts`.
- Produces: `interface AttackResult { check: CheckResult; hit: boolean; damage: number }`; `function resolverAtaque(config: RulesetConfig, attacker: CharacterSheet, rng?: Rng): AttackResult`; `function aplicarDano(config: RulesetConfig, defender: CharacterSheet, amount: number): CharacterSheet`.

- [ ] **Step 1: Escrever testes falhos**

`tests/rules-engine/combat.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolverAtaque, aplicarDano } from '../../src/rules-engine/combat';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('resolverAtaque', () => {
  const config = defaultRulesetConfig(); // attackAttribute: forca, defenseValue: 12, damageDie: 6
  const attacker = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });

  it('acerta quando o teste de ataque bate a defesa e rola dano', () => {
    // rng sequence: primeira chamada = teste de ataque (d20, rng=0.5 -> 11 + forca 3 = 14 >= 12)
    // segunda chamada = dado de dano (d6, rng=0.5 -> 4) + forca 3 = 7
    const calls = [0.5, 0.5];
    let i = 0;
    const rng = () => calls[i++];
    const result = resolverAtaque(config, attacker, rng);
    expect(result.hit).toBe(true);
    expect(result.check.total).toBe(14);
    expect(result.damage).toBe(7);
  });

  it('erra e não rola dano quando o teste de ataque não bate a defesa', () => {
    const rng = () => 0; // d20 rng=0 -> roll 1 + forca 3 = 4 < 12
    const result = resolverAtaque(config, attacker, rng);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });
});

describe('aplicarDano', () => {
  const config = defaultRulesetConfig();
  const defender = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });

  it('subtrai o dano do recurso de HP', () => {
    const updated = aplicarDano(config, defender, 5);
    expect(updated.resources.hp).toBe(defender.resources.hp - 5);
  });

  it('não deixa o recurso de HP ficar negativo', () => {
    const updated = aplicarDano(config, defender, 999);
    expect(updated.resources.hp).toBe(0);
  });

  it('não muta a ficha original', () => {
    const originalHp = defender.resources.hp;
    aplicarDano(config, defender, 5);
    expect(defender.resources.hp).toBe(originalHp);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/combat.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `combat.ts`**

`src/rules-engine/combat.ts`:
```ts
import { fazerTeste, type CheckResult } from './checks';
import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

export interface AttackResult {
  check: CheckResult;
  hit: boolean;
  damage: number;
}

export function resolverAtaque(
  config: RulesetConfig,
  attacker: CharacterSheet,
  rng: Rng = Math.random
): AttackResult {
  const check = fazerTeste(config, attacker, config.attackAttribute, config.defenseValue, rng);
  if (!check.success) {
    return { check, hit: false, damage: 0 };
  }
  const damageRoll = rollDie(config.damageDie, rng);
  const damage = damageRoll + attacker.attributes[config.attackAttribute];
  return { check, hit: true, damage };
}

export function aplicarDano(config: RulesetConfig, defender: CharacterSheet, amount: number): CharacterSheet {
  const current = defender.resources[config.hpResourceKey];
  const updated = Math.max(0, current - amount);
  return {
    ...defender,
    resources: { ...defender.resources, [config.hpResourceKey]: updated },
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/rules-engine/combat.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules-engine/combat.ts tests/rules-engine/combat.test.ts
git commit -m "feat: add attack resolution and damage application"
```

---

### Task 6: Iniciativa e controle de turno

**Files:**
- Create: `src/rules-engine/turn.ts`
- Test: `tests/rules-engine/turn.test.ts`

**Interfaces:**
- Consumes: `rollDie` de `dice.ts`; `CharacterSheet`, `RulesetConfig`, `Rng` de `types.ts`.
- Produces: `interface Combatant { id: string; name: string; initiative: number }`; `interface CombatState { order: Combatant[]; currentIndex: number }`; `function calcularIniciativa(config: RulesetConfig, participants: { id: string; name: string; character: CharacterSheet }[], rng?: Rng): CombatState`; `function avancarTurno(state: CombatState): CombatState`; `function turnoAtual(state: CombatState): Combatant`.

- [ ] **Step 1: Escrever testes falhos**

`tests/rules-engine/turn.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { calcularIniciativa, avancarTurno, turnoAtual } from '../../src/rules-engine/turn';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('calcularIniciativa', () => {
  const config = defaultRulesetConfig();
  const aria = createCharacterSheet(config, 'Aria', { forca: 5, destreza: 2, intelecto: 1 });
  const goblin = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });

  it('ordena os participantes por iniciativa decrescente', () => {
    const rolls = [0, 0.9]; // Aria: d20 rng=0 -> 1 + forca 5 = 6; Goblin: d20 rng=0.9 -> 19 + forca 1 = 20
    let i = 0;
    const rng = () => rolls[i++];
    const state = calcularIniciativa(
      config,
      [
        { id: 'p1', name: 'Aria', character: aria },
        { id: 'p2', name: 'Goblin', character: goblin },
      ],
      rng
    );
    expect(state.order.map((c) => c.id)).toEqual(['p2', 'p1']);
    expect(state.currentIndex).toBe(0);
  });
});

describe('avancarTurno e turnoAtual', () => {
  const config = defaultRulesetConfig();
  const aria = createCharacterSheet(config, 'Aria', { forca: 5, destreza: 2, intelecto: 1 });
  const goblin = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });
  const state = calcularIniciativa(
    config,
    [
      { id: 'p1', name: 'Aria', character: aria },
      { id: 'p2', name: 'Goblin', character: goblin },
    ],
    () => 0.5
  );

  it('turnoAtual retorna o combatente do índice atual', () => {
    expect(turnoAtual(state).id).toBeDefined();
  });

  it('avancarTurno avança para o próximo índice', () => {
    const next = avancarTurno(state);
    expect(next.currentIndex).toBe((state.currentIndex + 1) % state.order.length);
  });

  it('avancarTurno dá a volta para o início após o último combatente', () => {
    let current = state;
    for (let i = 0; i < current.order.length; i++) {
      current = avancarTurno(current);
    }
    expect(current.currentIndex).toBe(state.currentIndex);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/turn.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `turn.ts`**

`src/rules-engine/turn.ts`:
```ts
import { rollDie } from './dice';
import type { CharacterSheet, Rng, RulesetConfig } from './types';

export interface Combatant {
  id: string;
  name: string;
  initiative: number;
}

export interface CombatState {
  order: Combatant[];
  currentIndex: number;
}

export function calcularIniciativa(
  config: RulesetConfig,
  participants: { id: string; name: string; character: CharacterSheet }[],
  rng: Rng = Math.random
): CombatState {
  const rolled: Combatant[] = participants.map((p) => ({
    id: p.id,
    name: p.name,
    initiative: rollDie(config.testDie, rng) + p.character.attributes[config.attackAttribute],
  }));
  rolled.sort((a, b) => b.initiative - a.initiative);
  return { order: rolled, currentIndex: 0 };
}

export function avancarTurno(state: CombatState): CombatState {
  const nextIndex = (state.currentIndex + 1) % state.order.length;
  return { ...state, currentIndex: nextIndex };
}

export function turnoAtual(state: CombatState): Combatant {
  return state.order[state.currentIndex];
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/rules-engine/turn.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/rules-engine/turn.ts tests/rules-engine/turn.test.ts
git commit -m "feat: add initiative and turn tracking"
```

---

### Task 7: Barrel export do motor de regras

**Files:**
- Create: `src/rules-engine/index.ts`
- Test: `tests/rules-engine/index.test.ts`

**Interfaces:**
- Consumes: tudo de `types.ts`, `dice.ts`, `ruleset-config.ts`, `character.ts`, `checks.ts`, `combat.ts`, `turn.ts` (Tasks 1-6).
- Produces: reexporta a API pública inteira do motor de regras a partir de `src/rules-engine/index.ts` — este é o único caminho de import que os planos seguintes (bot, LLM) devem usar.

- [ ] **Step 1: Escrever teste falho garantindo que a API pública está completa**

`tests/rules-engine/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as RulesEngine from '../../src/rules-engine/index';

describe('rules-engine public API', () => {
  it('expõe todas as funções e validações usadas pelos planos seguintes', () => {
    expect(typeof RulesEngine.rollDie).toBe('function');
    expect(typeof RulesEngine.validateRulesetConfig).toBe('function');
    expect(typeof RulesEngine.defaultRulesetConfig).toBe('function');
    expect(typeof RulesEngine.createCharacterSheet).toBe('function');
    expect(typeof RulesEngine.fazerTeste).toBe('function');
    expect(typeof RulesEngine.resolverAtaque).toBe('function');
    expect(typeof RulesEngine.aplicarDano).toBe('function');
    expect(typeof RulesEngine.calcularIniciativa).toBe('function');
    expect(typeof RulesEngine.avancarTurno).toBe('function');
    expect(typeof RulesEngine.turnoAtual).toBe('function');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/rules-engine/index.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `index.ts`**

`src/rules-engine/index.ts`:
```ts
export type { Rng, DieSize, ResourceDef, RulesetConfig, CharacterSheet } from './types';
export { rollDie } from './dice';
export { validateRulesetConfig, defaultRulesetConfig, RulesetConfigSchema } from './ruleset-config';
export { createCharacterSheet } from './character';
export { fazerTeste, type CheckResult } from './checks';
export { resolverAtaque, aplicarDano, type AttackResult } from './combat';
export { calcularIniciativa, avancarTurno, turnoAtual, type Combatant, type CombatState } from './turn';
```

- [ ] **Step 4: Rodar todos os testes do motor de regras**

Run: `npx vitest run tests/rules-engine`
Expected: PASS (todos os testes das Tasks 1-7).

- [ ] **Step 5: Rodar o type check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/rules-engine/index.ts tests/rules-engine/index.test.ts
git commit -m "feat: add public barrel export for rules engine"
```

---

## Self-Review

**Cobertura da spec:** este plano cobre a peça "motor de regras" do design — dados, testes, resolução de ataque/dano, iniciativa e turnos, e o `ruleset_config` parametrizável por campanha (incluindo a base para configs extraídos de documento, tratada no Plano 5). Não cobre Discord, Postgres, LLM ou ingestão de documento — esses são os Planos 2-5.

**Placeholders:** nenhum "TBD"/"TODO"; todo código de cada step está completo e executável.

**Consistência de tipos:** `RulesetConfig`, `CharacterSheet`, `CheckResult`, `AttackResult`, `CombatState`, `Combatant` e todas as funções (`rollDie`, `validateRulesetConfig`, `defaultRulesetConfig`, `createCharacterSheet`, `fazerTeste`, `resolverAtaque`, `aplicarDano`, `calcularIniciativa`, `avancarTurno`, `turnoAtual`) são definidos uma única vez e reexportados sem renomear — os planos seguintes devem importar exclusivamente de `src/rules-engine/index.ts` usando esses nomes exatos.
