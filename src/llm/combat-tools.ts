import { aplicarDano, avancarTurno, resolverAtaque, turnoAtual, verificarFimDeCombate } from '../rules-engine';
import { clearCombatState, getCombatState, saveCombatState } from '../db/combat-repo';
import { updateCharacterAttributes, updateCharacterResources } from '../db/characters-repo';
import type { ToolContext, ToolDefinition } from './tools';

function requireCombat(ctx: ToolContext) {
  if (!ctx.combat) throw new Error('Esta ferramenta só pode ser usada durante um combate.');
  return ctx.combat;
}

export const resolverAtaqueTool: ToolDefinition = {
  name: 'resolver_ataque',
  description:
    'Resolve o ataque do personagem que está agindo contra um alvo do combate. Devolve se acertou e, se acertou, o dano causado. Sempre use esta ferramenta antes de aplicar dano em um ataque.',
  inputSchema: {
    type: 'object',
    properties: {
      targetName: { type: 'string', description: 'Nome do alvo do ataque, como aparece na lista de combatentes.' },
    },
    required: ['targetName'],
  },
  execute: async (input, ctx) => {
    const combat = requireCombat(ctx);
    const { targetName } = input as { targetName: string };
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const target = state.combatants.find((c) => c.name.toLowerCase() === targetName.toLowerCase());
    if (!target) throw new Error(`Alvo "${targetName}" não encontrado no combate.`);
    const attackAttr = ctx.config.attackAttribute;
    const wasMissing = ctx.actingCharacter.sheet.attributes[attackAttr] === undefined;
    const result = resolverAtaque(ctx.config, ctx.actingCharacter.sheet, ctx.rng);
    if (wasMissing && ctx.pool) {
      await updateCharacterAttributes(
        ctx.pool,
        ctx.actingCharacter.id,
        ctx.actingCharacter.sheet.attributes
      );
    }
    return { targetId: target.id, targetName: target.name, ...result };
  },
};

export const aplicarDanoTool: ToolDefinition = {
  name: 'aplicar_dano',
  description:
    'Aplica uma quantidade de dano ao recurso de pontos de vida de um alvo do combate, identificado pelo targetId devolvido por resolver_ataque. Se essa ação zerar os pontos de vida de todos os combatentes de um lado (jogadores ou inimigos), o combate é encerrado automaticamente e seu estado é limpo.',
  inputSchema: {
    type: 'object',
    properties: {
      targetId: { type: 'string', description: 'Id do alvo, devolvido por resolver_ataque.' },
      amount: { type: 'number', description: 'Quantidade de dano a aplicar.' },
    },
    required: ['targetId', 'amount'],
  },
  execute: async (input, ctx) => {
    const combat = requireCombat(ctx);
    const { targetId, amount } = input as { targetId: string; amount: number };
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const index = state.combatants.findIndex((c) => c.id === targetId);
    if (index === -1) throw new Error(`Alvo com id "${targetId}" não encontrado no combate.`);
    const target = state.combatants[index]!;
    const updatedSheet = aplicarDano(ctx.config, target.sheet, amount);
    const updatedCombatants = [...state.combatants];
    updatedCombatants[index] = { ...target, sheet: updatedSheet };
    if (target.characterId) {
      await updateCharacterResources(combat.pool, target.characterId, updatedSheet.resources);
    }
    const outcome = verificarFimDeCombate(ctx.config, updatedCombatants);
    if (outcome) {
      await clearCombatState(combat.pool, combat.campaignId);
    } else {
      await saveCombatState(combat.pool, { ...state, combatants: updatedCombatants });
    }
    return {
      targetId,
      targetName: target.name,
      resources: updatedSheet.resources,
      combatEnded: outcome !== null,
      ...(outcome ? { winner: outcome } : {}),
    };
  },
};

export const avancarTurnoTool: ToolDefinition = {
  name: 'avancar_turno',
  description:
    'Avança o combate para o próximo combatente na ordem de iniciativa. Use ao final da ação do personagem que está agindo.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async (_input, ctx) => {
    const combat = requireCombat(ctx);
    const state = await getCombatState(combat.pool, combat.campaignId);
    if (!state) throw new Error('Nenhum combate em andamento nesta campanha.');
    const nextState = avancarTurno({ order: state.order, currentIndex: state.currentIndex });
    await saveCombatState(combat.pool, { ...state, currentIndex: nextState.currentIndex });
    return turnoAtual(nextState);
  },
};
