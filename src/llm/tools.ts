import type { Pool } from 'pg';
import { fazerTeste, type CharacterSheet, type CurrencyNames, type Rng, type ValidatedRulesetConfig } from '../rules-engine';
import { updateCharacterAttributes, type StoredCharacter } from '../db/characters-repo';
import type { MasterGrantLogEntry } from '../db/campaigns-repo';

export interface ToolContext {
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
  /** Pool da campanha; usado para persistir atributos assumidos na ficha. */
  pool?: Pool;
  combat?: { pool: Pool; campaignId: string };
  narrativeMemory?: { pool: Pool; campaignId: string };
  campaignMemory?: {
    pool: Pool;
    campaignId: string;
    campaignMessageCount: number;
    masterGrantLog: MasterGrantLogEntry[];
    economyEnabled: boolean;
    currencyNames: CurrencyNames;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown>;
}

export const fazerTesteTool: ToolDefinition = {
  name: 'fazer_teste',
  description:
    'Resolve um teste de atributo rolando o dado configurado para a campanha. Use sempre que uma ação do jogador tiver resultado incerto (ex: percepção, persuasão, escalar um muro). Nunca invente o resultado de um teste — sempre chame esta ferramenta.',
  inputSchema: {
    type: 'object',
    properties: {
      attribute: {
        type: 'string',
        description: 'Nome do atributo a ser testado (deve ser um dos atributos da ficha do personagem).',
      },
      difficulty: {
        type: 'number',
        description: 'Dificuldade do teste (número que o resultado precisa igualar ou superar).',
      },
    },
    required: ['attribute', 'difficulty'],
  },
  execute: async (input, ctx) => {
    const { attribute, difficulty } = input as { attribute: unknown; difficulty: unknown };
    if (typeof attribute !== 'string' || attribute.length === 0) {
      throw new Error('Entrada inválida para fazer_teste: "attribute" deve ser uma string.');
    }
    if (typeof difficulty !== 'number' || Number.isNaN(difficulty)) {
      throw new Error('Entrada inválida para fazer_teste: "difficulty" deve ser um número.');
    }
    const wasMissing = ctx.actingCharacter.sheet.attributes[attribute] === undefined;
    const result = fazerTeste(ctx.config, ctx.actingCharacter.sheet, attribute, difficulty, ctx.rng);
    if (wasMissing && ctx.pool) {
      await updateCharacterAttributes(
        ctx.pool,
        ctx.actingCharacter.id,
        ctx.actingCharacter.sheet.attributes
      );
    }
    return result;
  },
};

export const consultarFichaTool: ToolDefinition = {
  name: 'consultar_ficha',
  description: 'Consulta a ficha do personagem que está agindo (atributos, recursos, inventário, poderes, XP; carteira só se a campanha tiver economia).',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async (_input, ctx): Promise<Record<string, unknown>> => {
    const sheet = ctx.actingCharacter.sheet;
    const base: Record<string, unknown> = {
      name: sheet.name,
      shortName: sheet.shortName,
      attributes: sheet.attributes,
      resources: sheet.resources,
      inventory: sheet.inventory,
      bagCapacity: sheet.bagCapacity,
      classKey: sheet.classKey,
      xp: sheet.xp,
      powers: sheet.powers,
    };
    if (ctx.campaignMemory?.economyEnabled) {
      base.wallet = sheet.wallet;
      base.currencyNames = ctx.campaignMemory.currencyNames;
    }
    return base;
  },
};
