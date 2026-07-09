import type { Pool } from 'pg';
import type { Campaign, RecentExchange } from '../db/campaigns-repo';
import { resetReflectionCounter, updateNarrativeState } from '../db/campaigns-repo';
import type { StoredCharacter } from '../db/characters-repo';
import type { Rng, ValidatedRulesetConfig } from '../rules-engine';
import type { LlmProvider } from './provider';
import type { ToolContext, ToolDefinition } from './tools';

function requireNarrativeMemory(ctx: ToolContext) {
  if (!ctx.narrativeMemory) {
    throw new Error('Esta ferramenta só pode ser usada com o contexto de memória narrativa configurado.');
  }
  return ctx.narrativeMemory;
}

export const atualizarEstadoNarrativoTool: ToolDefinition = {
  name: 'atualizar_estado_narrativo',
  description:
    'Atualiza o estado narrativo da campanha: o ritmo atual da cena, a próxima meta narrativa planejada e a lista completa de fatos que ainda importam para a história. Sempre devolva a lista completa de fatos cruciais, mantendo os que continuam relevantes e removendo os que já não importam.',
  inputSchema: {
    type: 'object',
    properties: {
      ritmo_atual: { type: 'string', description: 'Ritmo atual da cena: ação, mistério, descanso, etc.' },
      proximo_marco: { type: 'string', description: 'Próxima meta narrativa de curto prazo planejada pelo mestre.' },
      fatos_cruciais: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista completa e atualizada de fatos que ainda importam para a história.',
      },
    },
    required: ['ritmo_atual', 'proximo_marco', 'fatos_cruciais'],
  },
  execute: async (input, ctx) => {
    const narrativeMemory = requireNarrativeMemory(ctx);
    const { ritmo_atual, proximo_marco, fatos_cruciais } = input as {
      ritmo_atual: unknown;
      proximo_marco: unknown;
      fatos_cruciais: unknown;
    };
    if (typeof ritmo_atual !== 'string') {
      throw new Error('Entrada inválida para atualizar_estado_narrativo: "ritmo_atual" deve ser uma string.');
    }
    if (typeof proximo_marco !== 'string') {
      throw new Error('Entrada inválida para atualizar_estado_narrativo: "proximo_marco" deve ser uma string.');
    }
    if (!Array.isArray(fatos_cruciais) || !fatos_cruciais.every((f) => typeof f === 'string')) {
      throw new Error(
        'Entrada inválida para atualizar_estado_narrativo: "fatos_cruciais" deve ser uma lista de strings.'
      );
    }
    await updateNarrativeState(narrativeMemory.pool, narrativeMemory.campaignId, {
      ritmoAtual: ritmo_atual,
      proximoMarco: proximo_marco,
      fatosCruciais: fatos_cruciais,
    });
    return { ritmoAtual: ritmo_atual, proximoMarco: proximo_marco, fatosCruciais: fatos_cruciais };
  },
};

export const REFLECTION_INTERVAL = 10;

export function buildReflectionPrompt(params: {
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  recentExchanges: RecentExchange[];
}): { system: string; user: string } {
  const system = [
    'Você é o assistente de continuidade narrativa de uma campanha de RPG de mesa.',
    'Analise o estado atual e as trocas recentes entre jogador e mestre, e chame a ferramenta atualizar_estado_narrativo com o estado revisado.',
    'Sempre devolva a lista completa de fatos_cruciais: mantenha os que ainda importam para a história e remova os que já ficaram irrelevantes.',
    'Nunca narre a cena nem responda ao jogador diretamente — sua única saída deve ser a chamada da ferramenta.',
  ].join('\n');

  const exchangesText = params.recentExchanges
    .map((e) => `${e.characterName}: ${e.playerMessage}\nMestre: ${e.narration}`)
    .join('\n\n');

  const user = [
    `Ritmo atual registrado: ${params.ritmoAtual || '(nenhum registrado ainda)'}`,
    `Próximo marco registrado: ${params.proximoMarco || '(nenhum registrado ainda)'}`,
    `Fatos cruciais registrados: ${params.fatosCruciais.length ? params.fatosCruciais.join('; ') : '(nenhum registrado ainda)'}`,
    '',
    'Trocas recentes:',
    exchangesText || '(nenhuma troca registrada ainda)',
  ].join('\n');

  return { system, user };
}

export async function maybeRunReflection(params: {
  pool: Pool;
  campaignId: string;
  campaign: Campaign;
  llmProvider: LlmProvider;
  config: ValidatedRulesetConfig;
  actingCharacter: StoredCharacter;
  rng: Rng;
}): Promise<void> {
  if (params.campaign.messagesSinceReflection < REFLECTION_INTERVAL) return;

  const { system, user } = buildReflectionPrompt({
    ritmoAtual: params.campaign.ritmoAtual,
    proximoMarco: params.campaign.proximoMarco,
    fatosCruciais: params.campaign.fatosCruciais,
    recentExchanges: params.campaign.recentExchanges,
  });

  try {
    await params.llmProvider.runTurn(system, user, [atualizarEstadoNarrativoTool], {
      config: params.config,
      actingCharacter: params.actingCharacter,
      rng: params.rng,
      narrativeMemory: { pool: params.pool, campaignId: params.campaignId },
    });
  } catch (err) {
    console.error('Erro ao rodar o ciclo de reflexão narrativa:', err);
  } finally {
    await resetReflectionCounter(params.pool, params.campaignId);
  }
}
