import type { Pool } from 'pg';
import { fazerTeste, type CharacterSheet, type Rng, type ValidatedRulesetConfig } from '../rules-engine';
import type { StoredCharacter } from '../db/characters-repo';

export interface ToolContext {
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
  combat?: { pool: Pool; campaignId: string };
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
    return fazerTeste(ctx.config, ctx.actingCharacter.sheet, attribute, difficulty, ctx.rng);
  },
};

export const consultarFichaTool: ToolDefinition = {
  name: 'consultar_ficha',
  description: 'Consulta a ficha completa (atributos, recursos e inventário) do personagem que está agindo.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async (_input, ctx): Promise<CharacterSheet> => {
    return ctx.actingCharacter.sheet;
  },
};
