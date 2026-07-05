# Bot Discord e Persistência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a camada de persistência (Postgres) e o esqueleto do bot Discord, com os comandos `/criar-campanha` (ruleset padrão) e `/criar-personagem` (ficha dinâmica baseada no `ruleset_config` da campanha).

**Architecture:** Repositórios (`src/db/*-repo.ts`) encapsulam todo acesso a Postgres via `pg`; testes usam `pg-mem` para rodar a mesma migração SQL em memória, sem precisar de um Postgres real. O bot (`discord.js`) expõe slash commands que chamam os repositórios e o motor de regras (Plano 1). Cada campanha é isolada por `guild_id` + `channel_id` (multi-tenant nativo do Discord).

**Tech Stack:** Node.js 20+, TypeScript, discord.js v14, `pg`, `pg-mem` (testes), Vitest, dotenv.

## Global Constraints

- Depende do Plano 1 (motor de regras) já implementado e commitado — todo import de tipos/funções de regras vem de `src/rules-engine/index.ts`.
- Toda campanha é isolada por `(guild_id, channel_id)` — chave única na tabela `campaigns`.
- Nenhuma mutação de estado de jogo é aplicada sem antes validar os dados de entrada (ex: valores de atributo não numéricos são rejeitados antes de chamar `createCharacterSheet`).
- `ruleset_config.attributes` tem no máximo 5 itens (herdado do Plano 1) — a ficha de personagem usa um modal do Discord, que suporta no máximo 5 campos de texto.
- Testes de banco usam `pg-mem`, nunca um Postgres real — a mesma migração SQL roda em ambos.
- Segredos (token do Discord, connection string do Postgres) vêm de variáveis de ambiente, nunca hardcoded.

---

## Estrutura de arquivos

```
RPGMaster/
  .env.example
  scripts/
    migrate.ts
    register-commands.ts
  src/
    config.ts
    db/
      migrations/001_init.sql
      pool.ts
      test-db.ts
      campaigns-repo.ts
      characters-repo.ts
    bot/
      client.ts
      interaction-router.ts
      commands/
        criar-campanha.ts
        criar-personagem.ts
    index.ts
  tests/
    config.test.ts
    db/
      campaigns-repo.test.ts
      characters-repo.test.ts
    bot/
      client.test.ts
      interaction-router.test.ts
      commands/
        criar-campanha.test.ts
        criar-personagem.test.ts
```

---

### Task 1: Migração SQL, pool de conexão e pool de teste

**Files:**
- Create: `src/db/migrations/001_init.sql`
- Create: `src/db/pool.ts`
- Create: `src/db/test-db.ts`
- Test: `tests/db/test-db.test.ts`

**Interfaces:**
- Produces: `function createPool(connectionString: string): Pool` (pg real); `function createTestPool(): Pool` (pg-mem, mesma migração aplicada).

- [ ] **Step 1: Adicionar dependências de banco ao `package.json`**

Adicionar em `dependencies`: `"dotenv": "^16.4.5"` (já existiam `pg` e `pg-mem` desde o Plano 1). Rodar:

Run: `npm install dotenv`
Expected: instala sem erro.

- [ ] **Step 2: Escrever teste falho para `createTestPool`**

`tests/db/test-db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createTestPool } from '../../src/db/test-db';

describe('createTestPool', () => {
  it('aplica a migração e permite inserir em campaigns', async () => {
    const pool = createTestPool();
    const result = await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('c1', 'g1', 'ch1', 'Teste', 'active', '{}', '')
       RETURNING id`
    );
    expect(result.rows[0].id).toBe('c1');
  });

  it('impede duas campanhas no mesmo guild_id + channel_id', async () => {
    const pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('c1', 'g1', 'ch1', 'Teste', 'active', '{}', '')`
    );
    await expect(
      pool.query(
        `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
         VALUES ('c2', 'g1', 'ch1', 'Outra', 'active', '{}', '')`
      )
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Rodar e confirmar falha**

Run: `npx vitest run tests/db/test-db.test.ts`
Expected: FAIL — módulos `src/db/test-db` e `src/db/migrations/001_init.sql` não existem.

- [ ] **Step 4: Implementar migração, pool real e pool de teste**

`src/db/migrations/001_init.sql`:
```sql
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ruleset_config JSONB NOT NULL,
  lore TEXT NOT NULL DEFAULT '',
  session_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guild_id, channel_id)
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  player_discord_id TEXT NOT NULL,
  name TEXT NOT NULL,
  attributes JSONB NOT NULL,
  resources JSONB NOT NULL,
  inventory JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, player_discord_id)
);

CREATE TABLE combat_states (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  order_json JSONB NOT NULL,
  current_index INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`src/db/pool.ts`:
```ts
import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
```

`src/db/test-db.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb();
  const schema = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf-8');
  db.public.none(schema);
  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/test-db.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/db/migrations/001_init.sql src/db/pool.ts src/db/test-db.ts tests/db/test-db.test.ts
git commit -m "feat: add database schema, connection pool and test pool"
```

---

### Task 2: Repositório de campanhas

**Files:**
- Create: `src/db/campaigns-repo.ts`
- Test: `tests/db/campaigns-repo.test.ts`

**Interfaces:**
- Consumes: `createTestPool` de `src/db/test-db.ts` (Task 1, só em teste); `ValidatedRulesetConfig` de `src/rules-engine` (Plano 1).
- Produces: `type CampaignStatus = 'draft' | 'active'`; `interface Campaign { id: string; guildId: string; channelId: string; name: string; status: CampaignStatus; rulesetConfig: ValidatedRulesetConfig; lore: string; sessionSummary: string }`; `function createCampaign(pool: Pool, params: { guildId: string; channelId: string; name: string; rulesetConfig: ValidatedRulesetConfig; lore?: string; status?: CampaignStatus }): Promise<Campaign>`; `function getCampaignByChannel(pool: Pool, guildId: string, channelId: string): Promise<Campaign | null>`.

Nota: `Campaign.rulesetConfig` usa `ValidatedRulesetConfig` (o branded type do Plano 1, Task 2 — reforçado depois da revisão final do Plano 1), não `RulesetConfig` puro. Isso garante, em tempo de compilação, que qualquer config lida de volta do banco só pode ser passada para as funções do motor de regras (`createCharacterSheet`, `fazerTeste` etc.) — todas exigem `ValidatedRulesetConfig`. O cast em `rowToCampaign` é legítimo porque esta tabela só recebe configs por meio de `createCampaign`, cujo parâmetro já exige `ValidatedRulesetConfig`.

- [ ] **Step 1: Escrever testes falhos**

`tests/db/campaigns-repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCampaign, getCampaignByChannel } from '../../src/db/campaigns-repo';
import { defaultRulesetConfig } from '../../src/rules-engine';

describe('campaigns-repo', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('cria uma campanha e devolve os dados salvos', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    expect(campaign.id).toBeTruthy();
    expect(campaign.name).toBe('A Torre Esquecida');
    expect(campaign.status).toBe('active');
    expect(campaign.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
  });

  it('busca uma campanha por guildId + channelId', async () => {
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'A Torre Esquecida',
      rulesetConfig: defaultRulesetConfig(),
    });
    const found = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(found?.name).toBe('A Torre Esquecida');
  });

  it('retorna null quando não há campanha no canal', async () => {
    const found = await getCampaignByChannel(pool, 'guild-1', 'channel-inexistente');
    expect(found).toBeNull();
  });

  it('cria campanha em status draft quando especificado', async () => {
    const campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Rascunho',
      rulesetConfig: defaultRulesetConfig(),
      status: 'draft',
    });
    expect(campaign.status).toBe('draft');
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `campaigns-repo.ts`**

`src/db/campaigns-repo.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ValidatedRulesetConfig } from '../rules-engine';

export type CampaignStatus = 'draft' | 'active';

export interface Campaign {
  id: string;
  guildId: string;
  channelId: string;
  name: string;
  status: CampaignStatus;
  rulesetConfig: ValidatedRulesetConfig;
  lore: string;
  sessionSummary: string;
}

function rowToCampaign(row: Record<string, unknown>): Campaign {
  return {
    id: row.id as string,
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
    name: row.name as string,
    status: row.status as CampaignStatus,
    rulesetConfig: row.ruleset_config as ValidatedRulesetConfig,
    lore: row.lore as string,
    sessionSummary: row.session_summary as string,
  };
}

export async function createCampaign(
  pool: Pool,
  params: {
    guildId: string;
    channelId: string;
    name: string;
    rulesetConfig: ValidatedRulesetConfig;
    lore?: string;
    status?: CampaignStatus;
  }
): Promise<Campaign> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      params.guildId,
      params.channelId,
      params.name,
      params.status ?? 'active',
      JSON.stringify(params.rulesetConfig),
      params.lore ?? '',
    ]
  );
  return rowToCampaign(result.rows[0]);
}

export async function getCampaignByChannel(
  pool: Pool,
  guildId: string,
  channelId: string
): Promise<Campaign | null> {
  const result = await pool.query(`SELECT * FROM campaigns WHERE guild_id = $1 AND channel_id = $2`, [
    guildId,
    channelId,
  ]);
  return result.rows[0] ? rowToCampaign(result.rows[0]) : null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/campaigns-repo.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/db/campaigns-repo.ts tests/db/campaigns-repo.test.ts
git commit -m "feat: add campaigns repository"
```

---

### Task 3: Repositório de personagens

**Files:**
- Create: `src/db/characters-repo.ts`
- Test: `tests/db/characters-repo.test.ts`

**Interfaces:**
- Consumes: `createTestPool` (Task 1); `CharacterSheet` de `src/rules-engine` (Plano 1).
- Produces: `interface StoredCharacter { id: string; campaignId: string; playerDiscordId: string; sheet: CharacterSheet }`; `function createCharacter(pool: Pool, params: { campaignId: string; playerDiscordId: string; sheet: CharacterSheet }): Promise<StoredCharacter>`; `function getCharacterByPlayer(pool: Pool, campaignId: string, playerDiscordId: string): Promise<StoredCharacter | null>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/db/characters-repo.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../src/db/test-db';
import { createCharacter, getCharacterByPlayer } from '../../src/db/characters-repo';
import type { CharacterSheet } from '../../src/rules-engine';

const ariaSheet: CharacterSheet = {
  name: 'Aria',
  attributes: { forca: 3, destreza: 2, intelecto: 1 },
  resources: { hp: 13 },
  inventory: [],
};

describe('characters-repo', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await pool.query(
      `INSERT INTO campaigns (id, guild_id, channel_id, name, status, ruleset_config, lore)
       VALUES ('camp-1', 'guild-1', 'channel-1', 'Teste', 'active', '{}', '')`
    );
  });

  it('cria um personagem e devolve a ficha salva', async () => {
    const stored = await createCharacter(pool, {
      campaignId: 'camp-1',
      playerDiscordId: 'player-1',
      sheet: ariaSheet,
    });
    expect(stored.id).toBeTruthy();
    expect(stored.sheet).toEqual(ariaSheet);
  });

  it('busca um personagem por jogador na campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    const found = await getCharacterByPlayer(pool, 'camp-1', 'player-1');
    expect(found?.sheet.name).toBe('Aria');
  });

  it('retorna null quando o jogador não tem personagem na campanha', async () => {
    const found = await getCharacterByPlayer(pool, 'camp-1', 'player-sem-ficha');
    expect(found).toBeNull();
  });

  it('impede dois personagens do mesmo jogador na mesma campanha', async () => {
    await createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet });
    await expect(
      createCharacter(pool, { campaignId: 'camp-1', playerDiscordId: 'player-1', sheet: ariaSheet })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/db/characters-repo.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `characters-repo.ts`**

`src/db/characters-repo.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CharacterSheet } from '../rules-engine';

export interface StoredCharacter {
  id: string;
  campaignId: string;
  playerDiscordId: string;
  sheet: CharacterSheet;
}

function rowToCharacter(row: Record<string, unknown>): StoredCharacter {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    playerDiscordId: row.player_discord_id as string,
    sheet: {
      name: row.name as string,
      attributes: row.attributes as Record<string, number>,
      resources: row.resources as Record<string, number>,
      inventory: row.inventory as string[],
    },
  };
}

export async function createCharacter(
  pool: Pool,
  params: { campaignId: string; playerDiscordId: string; sheet: CharacterSheet }
): Promise<StoredCharacter> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO characters (id, campaign_id, player_discord_id, name, attributes, resources, inventory)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      params.campaignId,
      params.playerDiscordId,
      params.sheet.name,
      JSON.stringify(params.sheet.attributes),
      JSON.stringify(params.sheet.resources),
      JSON.stringify(params.sheet.inventory),
    ]
  );
  return rowToCharacter(result.rows[0]);
}

export async function getCharacterByPlayer(
  pool: Pool,
  campaignId: string,
  playerDiscordId: string
): Promise<StoredCharacter | null> {
  const result = await pool.query(
    `SELECT * FROM characters WHERE campaign_id = $1 AND player_discord_id = $2`,
    [campaignId, playerDiscordId]
  );
  return result.rows[0] ? rowToCharacter(result.rows[0]) : null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/db/characters-repo.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/db/characters-repo.ts tests/db/characters-repo.test.ts
git commit -m "feat: add characters repository"
```

---

### Task 4: Configuração de ambiente e cliente Discord

**Files:**
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `src/bot/client.ts`
- Test: `tests/config.test.ts`
- Test: `tests/bot/client.test.ts`

**Interfaces:**
- Produces: `interface Config { discordToken: string; discordClientId: string; databaseUrl: string }`; `function loadConfig(env?: NodeJS.ProcessEnv): Config`; `function createDiscordClient(): Client` (de `discord.js`).

- [ ] **Step 1: Escrever testes falhos**

`tests/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('carrega uma config válida a partir do ambiente', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'token-a', DISCORD_CLIENT_ID: 'client-b', DATABASE_URL: 'postgres://c' });
    expect(config).toEqual({ discordToken: 'token-a', discordClientId: 'client-b', databaseUrl: 'postgres://c' });
  });

  it('lança erro quando falta DISCORD_TOKEN', () => {
    expect(() => loadConfig({ DISCORD_CLIENT_ID: 'b', DATABASE_URL: 'c' })).toThrow(/DISCORD_TOKEN/);
  });

  it('lança erro quando falta DATABASE_URL', () => {
    expect(() => loadConfig({ DISCORD_TOKEN: 'a', DISCORD_CLIENT_ID: 'b' })).toThrow(/DATABASE_URL/);
  });
});
```

`tests/bot/client.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Client } from 'discord.js';
import { createDiscordClient } from '../../src/bot/client';

describe('createDiscordClient', () => {
  it('cria uma instância de Client do discord.js', () => {
    const client = createDiscordClient();
    expect(client).toBeInstanceOf(Client);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/config.test.ts tests/bot/client.test.ts`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar `config.ts` e `client.ts`, e criar `.env.example`**

`.env.example`:
```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DATABASE_URL=postgres://user:password@localhost:5432/rpgmaster
ANTHROPIC_API_KEY=
```

`src/config.ts`:
```ts
export interface Config {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordToken = env.DISCORD_TOKEN;
  const discordClientId = env.DISCORD_CLIENT_ID;
  const databaseUrl = env.DATABASE_URL;
  if (!discordToken) throw new Error('DISCORD_TOKEN não definido');
  if (!discordClientId) throw new Error('DISCORD_CLIENT_ID não definido');
  if (!databaseUrl) throw new Error('DATABASE_URL não definido');
  return { discordToken, discordClientId, databaseUrl };
}
```

`src/bot/client.ts`:
```ts
import { Client, GatewayIntentBits } from 'discord.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/config.test.ts tests/bot/client.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add .env.example src/config.ts src/bot/client.ts tests/config.test.ts tests/bot/client.test.ts
git commit -m "feat: add environment config and discord client factory"
```

---

### Task 5: Comando `/criar-campanha`

**Files:**
- Create: `src/bot/commands/criar-campanha.ts`
- Test: `tests/bot/commands/criar-campanha.test.ts`

**Interfaces:**
- Consumes: `createCampaign`, `getCampaignByChannel`, `Campaign` de `src/db/campaigns-repo.ts` (Task 2); `defaultRulesetConfig` de `src/rules-engine` (Plano 1).
- Produces: `export const data: SlashCommandBuilder` (nome `criar-campanha`, opção string `nome` obrigatória); `async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/commands/criar-campanha.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { execute } from '../../../src/bot/commands/criar-campanha';
import { getCampaignByChannel } from '../../../src/db/campaigns-repo';

function makeInteraction(overrides: { guildId?: string | null; channelId?: string; nome?: string } = {}) {
  const guildId = 'guildId' in overrides ? overrides.guildId : 'guild-1';
  const channelId = overrides.channelId ?? 'channel-1';
  const nome = overrides.nome ?? 'A Torre Esquecida';
  const replies: unknown[] = [];
  return {
    guildId,
    channelId,
    options: { getString: () => nome },
    reply: async (payload: unknown) => {
      replies.push(payload);
    },
    _replies: replies,
  } as any;
}

describe('/criar-campanha execute', () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createTestPool();
  });

  it('cria uma campanha com o ruleset padrão quando o canal está livre', async () => {
    const interaction = makeInteraction();
    await execute(interaction, pool);
    const campaign = await getCampaignByChannel(pool, 'guild-1', 'channel-1');
    expect(campaign?.name).toBe('A Torre Esquecida');
    expect(campaign?.rulesetConfig.name).toBe('Sistema Simplificado Padrão');
    expect(interaction._replies[0]).toContain('A Torre Esquecida');
  });

  it('recusa criar uma segunda campanha no mesmo canal', async () => {
    await execute(makeInteraction(), pool);
    const interaction2 = makeInteraction();
    await execute(interaction2, pool);
    const reply = interaction2._replies[0] as { content: string };
    expect(reply.content).toMatch(/já existe/i);
  });

  it('recusa quando usado fora de um servidor', async () => {
    const interaction = makeInteraction({ guildId: null });
    await execute(interaction, pool);
    const reply = interaction._replies[0] as { content: string };
    expect(reply.content).toMatch(/servidor/i);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `criar-campanha.ts`**

`src/bot/commands/criar-campanha.ts`:
```ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig } from '../../rules-engine';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const existing = await getCampaignByChannel(pool, guildId, channelId);
  if (existing) {
    await interaction.reply({ content: `Já existe uma campanha ativa neste canal: "${existing.name}".`, ephemeral: true });
    return;
  }
  const nome = interaction.options.getString('nome', true);
  const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig() });
  await interaction.reply(`Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/commands/criar-campanha.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/criar-campanha.ts tests/bot/commands/criar-campanha.test.ts
git commit -m "feat: add /criar-campanha command"
```

---

### Task 6: Comando `/criar-personagem` (modal dinâmico)

**Files:**
- Create: `src/bot/commands/criar-personagem.ts`
- Test: `tests/bot/commands/criar-personagem.test.ts`

**Interfaces:**
- Consumes: `getCampaignByChannel`, `Campaign` de `src/db/campaigns-repo.ts` (Task 2); `createCharacter`, `getCharacterByPlayer` de `src/db/characters-repo.ts` (Task 3); `createCharacterSheet` de `src/rules-engine` (Plano 1); `createCampaign` (só em teste, para preparar fixtures).
- Produces: `export const data: SlashCommandBuilder` (nome `criar-personagem`, opção string `nome` obrigatória); `function buildCharacterModal(campaign: Campaign, characterName: string): ModalBuilder`; `async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void>`; `async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/commands/criar-personagem.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool } from '../../../src/db/test-db';
import { createCampaign, type Campaign } from '../../../src/db/campaigns-repo';
import { getCharacterByPlayer } from '../../../src/db/characters-repo';
import { defaultRulesetConfig } from '../../../src/rules-engine';
import { buildCharacterModal, execute, handleModalSubmit } from '../../../src/bot/commands/criar-personagem';

describe('buildCharacterModal', () => {
  const campaign: Campaign = {
    id: 'camp-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    name: 'Teste',
    status: 'active',
    rulesetConfig: defaultRulesetConfig(),
    lore: '',
    sessionSummary: '',
  };

  it('gera um customId codificando campanha e nome do personagem', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    expect(modal.toJSON().custom_id).toBe('criar-personagem:camp-1:Aria');
  });

  it('gera um campo de texto para cada atributo do ruleset', () => {
    const modal = buildCharacterModal(campaign, 'Aria');
    const json = modal.toJSON();
    const fieldIds = json.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));
    expect(fieldIds).toEqual(['forca', 'destreza', 'intelecto']);
  });
});

describe('/criar-personagem execute', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
  });

  it('mostra o modal quando a campanha existe e o jogador não tem personagem', async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      options: { getString: () => 'Aria' },
      showModal,
      reply: vi.fn(),
    } as any;
    await execute(interaction, pool);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it('recusa quando não há campanha ativa no canal', async () => {
    const reply = vi.fn();
    const interaction = {
      guildId: 'guild-1',
      channelId: 'channel-sem-campanha',
      user: { id: 'player-1' },
      options: { getString: () => 'Aria' },
      showModal: vi.fn(),
      reply,
    } as any;
    await execute(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/nenhuma campanha/i) }));
  });
});

describe('/criar-personagem handleModalSubmit', () => {
  let pool: Pool;
  let campaign: Awaited<ReturnType<typeof createCampaign>>;

  beforeEach(async () => {
    pool = createTestPool();
    campaign = await createCampaign(pool, {
      guildId: 'guild-1',
      channelId: 'channel-1',
      name: 'Teste',
      rulesetConfig: defaultRulesetConfig(),
    });
  });

  it('cria o personagem a partir dos valores enviados no modal', async () => {
    const values: Record<string, string> = { forca: '3', destreza: '2', intelecto: '1' };
    const interaction = {
      customId: `criar-personagem:${campaign.id}:Aria`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply: vi.fn(),
    } as any;
    await handleModalSubmit(interaction, pool);
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character?.sheet.name).toBe('Aria');
    expect(character?.sheet.attributes).toEqual({ forca: 3, destreza: 2, intelecto: 1 });
  });

  it('recusa quando um atributo enviado não é numérico', async () => {
    const values: Record<string, string> = { forca: 'muito', destreza: '2', intelecto: '1' };
    const reply = vi.fn();
    const interaction = {
      customId: `criar-personagem:${campaign.id}:Aria`,
      guildId: 'guild-1',
      channelId: 'channel-1',
      user: { id: 'player-1' },
      fields: { getTextInputValue: (key: string) => values[key] },
      reply,
    } as any;
    await handleModalSubmit(interaction, pool);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/forca/i) }));
    const character = await getCharacterByPlayer(pool, campaign.id, 'player-1');
    expect(character).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/commands/criar-personagem.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `criar-personagem.ts`**

`src/bot/commands/criar-personagem.ts`:
```ts
import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, type Campaign } from '../../db/campaigns-repo';
import { createCharacter, getCharacterByPlayer } from '../../db/characters-repo';
import { createCharacterSheet } from '../../rules-engine';

export const data = new SlashCommandBuilder()
  .setName('criar-personagem')
  .setDescription('Cria sua ficha de personagem nesta campanha')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome do personagem').setRequired(true));

export function buildCharacterModal(campaign: Campaign, characterName: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`criar-personagem:${campaign.id}:${characterName}`)
    .setTitle(`Atributos de ${characterName}`);
  const rows = campaign.rulesetConfig.attributes.map((attr) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(attr).setLabel(attr).setStyle(TextInputStyle.Short).setRequired(true)
    )
  );
  modal.addComponents(...rows);
  return modal;
}

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'active') {
    await interaction.reply({ content: 'Nenhuma campanha ativa neste canal.', ephemeral: true });
    return;
  }
  const existing = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `Você já tem um personagem nesta campanha: "${existing.sheet.name}".`,
      ephemeral: true,
    });
    return;
  }
  const nome = interaction.options.getString('nome', true);
  await interaction.showModal(buildCharacterModal(campaign, nome));
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void> {
  const [, campaignId, nome] = interaction.customId.split(':');
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) return;
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.id !== campaignId) {
    await interaction.reply({ content: 'Campanha não encontrada.', ephemeral: true });
    return;
  }
  const attributeValues: Record<string, number> = {};
  for (const attr of campaign.rulesetConfig.attributes) {
    const raw = interaction.fields.getTextInputValue(attr);
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      await interaction.reply({ content: `Valor inválido para o atributo "${attr}": deve ser um número.`, ephemeral: true });
      return;
    }
    attributeValues[attr] = value;
  }
  const sheet = createCharacterSheet(campaign.rulesetConfig, nome, attributeValues);
  await createCharacter(pool, { campaignId: campaign.id, playerDiscordId: interaction.user.id, sheet });
  await interaction.reply(`Personagem "${nome}" criado com sucesso!`);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/commands/criar-personagem.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands/criar-personagem.ts tests/bot/commands/criar-personagem.test.ts
git commit -m "feat: add /criar-personagem command with dynamic modal"
```

---

### Task 7: Roteador de interações

**Files:**
- Create: `src/bot/interaction-router.ts`
- Test: `tests/bot/interaction-router.test.ts`

**Interfaces:**
- Consumes: `execute` de `criar-campanha.ts` (Task 5); `execute`, `handleModalSubmit` de `criar-personagem.ts` (Task 6).
- Produces: `async function routeInteraction(interaction: Interaction, pool: Pool): Promise<void>`.

- [ ] **Step 1: Escrever testes falhos**

`tests/bot/interaction-router.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { routeInteraction } from '../../src/bot/interaction-router';
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';

describe('routeInteraction', () => {
  const pool = {} as Pool;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('despacha /criar-campanha para criarCampanha.execute', async () => {
    const spy = vi.spyOn(criarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'criar-campanha',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /criar-personagem para criarPersonagem.execute', async () => {
    const spy = vi.spyOn(criarPersonagem, 'execute').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'criar-personagem',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal criar-personagem:* para criarPersonagem.handleModalSubmit', async () => {
    const spy = vi.spyOn(criarPersonagem, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: 'criar-personagem:abc123:Aria',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('ignora comandos desconhecidos sem lançar erro', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'comando-desconhecido',
    } as any;
    await expect(routeInteraction(interaction, pool)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx vitest run tests/bot/interaction-router.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar `interaction-router.ts`**

`src/bot/interaction-router.ts`:
```ts
import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';

export async function routeInteraction(interaction: Interaction, pool: Pool): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'criar-personagem') {
      await criarPersonagem.execute(interaction, pool);
      return;
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('criar-personagem:')) {
      await criarPersonagem.handleModalSubmit(interaction, pool);
      return;
    }
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/bot/interaction-router.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/bot/interaction-router.ts tests/bot/interaction-router.test.ts
git commit -m "feat: add interaction router"
```

---

### Task 8: Ponto de entrada, registro de comandos e smoke test manual

**Files:**
- Create: `scripts/migrate.ts`
- Create: `scripts/register-commands.ts`
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 4); `createPool` (Task 1); `createDiscordClient` (Task 4); `routeInteraction` (Task 7); `data` de `criar-campanha.ts` e `criar-personagem.ts` (Tasks 5-6).
- Produces: processo executável (`npm run dev`, `npm run migrate`, `npm run register-commands`) — não expõe novas funções para planos futuros além do que já foi exportado.

- [ ] **Step 1: Adicionar scripts ao `package.json`**

Adicionar em `scripts`: `"migrate": "tsx scripts/migrate.ts"`, `"register-commands": "tsx scripts/register-commands.ts"`.

- [ ] **Step 2: Implementar script de migração**

`scripts/migrate.ts`:
```ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { loadConfig } from '../src/config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_init.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migração aplicada com sucesso.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Implementar script de registro de comandos**

`scripts/register-commands.ts`:
```ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config';
import { data as criarCampanhaData } from '../src/bot/commands/criar-campanha';
import { data as criarPersonagemData } from '../src/bot/commands/criar-personagem';

async function main() {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: [criarCampanhaData.toJSON(), criarPersonagemData.toJSON()],
  });
  console.log('Comandos registrados com sucesso.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Implementar ponto de entrada do bot**

`src/index.ts`:
```ts
import 'dotenv/config';
import { createPool } from './db/pool';
import { createDiscordClient } from './bot/client';
import { routeInteraction } from './bot/interaction-router';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = createDiscordClient();

  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool).catch((err) => {
      console.error('Erro ao processar interação:', err);
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

- [ ] **Step 5: Rodar a suíte inteira e o type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS em todos os testes (Planos 1 e 2), sem erros de tipo.

- [ ] **Step 6: Smoke test manual (requer Postgres real e uma aplicação Discord de teste)**

1. Criar um banco Postgres local ou gerenciado; copiar `.env.example` para `.env` e preencher `DATABASE_URL`.
2. Criar uma aplicação/bot no [Discord Developer Portal](https://discord.com/developers/applications); preencher `DISCORD_TOKEN` e `DISCORD_CLIENT_ID` no `.env`; convidar o bot para um servidor de teste com os escopos `bot` e `applications.commands`.
3. Rodar: `npm run migrate` — confirmar que as tabelas são criadas sem erro.
4. Rodar: `npm run register-commands` — confirmar que os comandos aparecem no servidor de teste.
5. Rodar: `npm run dev` — confirmar no console a mensagem "Bot conectado como ...".
6. No servidor de teste, rodar `/criar-campanha nome:Minha Aventura` — confirmar resposta de sucesso.
7. Rodar `/criar-personagem nome:Aria` — confirmar que o modal aparece com os campos `forca`, `destreza`, `intelecto`; preencher e enviar — confirmar resposta de sucesso.
8. Rodar `/criar-personagem` novamente com o mesmo usuário — confirmar que é recusado por já ter personagem.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/migrate.ts scripts/register-commands.ts src/index.ts
git commit -m "feat: add entry point, migration script and command registration"
```

---

## Self-Review

**Cobertura da spec:** cobre persistência (Postgres com isolamento por `guild_id`+`channel_id`), criação de campanha com ruleset padrão, e criação de ficha de personagem dinâmica a partir do `ruleset_config`. Upload de documento, laço narrativo com LLM e combate ficam para os Planos 3-5.

**Placeholders:** nenhum — todo código é completo; o Step 6 da Task 8 é deliberadamente manual (requer infraestrutura real: Postgres e aplicação Discord), mas cada instrução é concreta e verificável.

**Consistência de tipos:** `Campaign`, `CampaignStatus`, `StoredCharacter` são definidos uma vez em seus respectivos repositórios e importados com os mesmos nomes em comandos e testes. `execute`/`handleModalSubmit`/`buildCharacterModal` mantêm assinatura idêntica entre implementação e testes.
