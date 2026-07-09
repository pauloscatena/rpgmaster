import {
  canMasterGrant,
  validateGrantReason,
  validateMasterXpAmount,
  applyWalletDelta,
  formatWallet,
  type ValidatedRulesetConfig,
} from '../rules-engine';
import { appendMasterGrantLog } from '../db/campaigns-repo';
import { updateCharacterProgress } from '../db/characters-repo';
import type { ToolContext, ToolDefinition } from './tools';

function requireCampaignMemory(ctx: ToolContext) {
  if (!ctx.campaignMemory) throw new Error('Contexto de campanha indisponível para esta ferramenta.');
  return ctx.campaignMemory;
}

function countGrantsForCharacter(log: { characterId: string; type: string }[], characterId: string): number {
  return log.filter((e) => e.characterId === characterId && (e.type === 'xp' || e.type === 'power')).length;
}

export const concederXpTool: ToolDefinition = {
  name: 'conceder_xp',
  description:
    'Concede uma pequena quantidade de XP ao personagem que está agindo. Use raramente: só em decisão significativa + virada de trama. Nunca use em ações rotineiras.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'XP a conceder (1 a 5).' },
      reason: { type: 'string', description: 'Motivo narrativo (mín. 8 caracteres).' },
    },
    required: ['amount', 'reason'],
  },
  execute: async (input, ctx) => {
    const mem = requireCampaignMemory(ctx);
    const { amount, reason: rawReason } = input as { amount: unknown; reason: unknown };
    const reasonOk = validateGrantReason(rawReason);
    if (!reasonOk.ok) throw new Error(reasonOk.error);
    const amountOk = validateMasterXpAmount(amount as number);
    if (!amountOk.ok) throw new Error(amountOk.error);
    const gate = canMasterGrant({
      evolutionEnabled: ctx.config.evolutionEnabled,
      campaignMessageCount: mem.campaignMessageCount,
      lastMasterGrantAtCampaignMessages: ctx.actingCharacter.sheet.lastMasterGrantAtCampaignMessages,
      priorGrantCountForCharacter: countGrantsForCharacter(mem.masterGrantLog, ctx.actingCharacter.id),
    });
    if (!gate.ok) throw new Error(gate.error);

    const newXp = ctx.actingCharacter.sheet.xp + (amount as number);
    const updated = await updateCharacterProgress(mem.pool, ctx.actingCharacter.id, {
      xp: newXp,
      lastMasterGrantAtCampaignMessages: mem.campaignMessageCount,
    });
    ctx.actingCharacter.sheet = updated.sheet;
    await appendMasterGrantLog(mem.pool, mem.campaignId, {
      at: new Date().toISOString(),
      characterId: ctx.actingCharacter.id,
      type: 'xp',
      amount: amount as number,
      reason: reasonOk.reason,
      campaignMessageCount: mem.campaignMessageCount,
    });
    return { granted: true, xp: newXp, amount };
  },
};

export const concederPoderTool: ToolDefinition = {
  name: 'conceder_poder',
  description:
    'Ensina um poder da classe do personagem no nível 1. Use raramente (despertar excepcional). O poder deve existir no catálogo da classe e o personagem ainda não pode conhecê-lo.',
  inputSchema: {
    type: 'object',
    properties: {
      powerKey: { type: 'string', description: 'Chave do poder no catálogo do ruleset.' },
      reason: { type: 'string', description: 'Motivo narrativo (mín. 8 caracteres).' },
    },
    required: ['powerKey', 'reason'],
  },
  execute: async (input, ctx) => {
    const mem = requireCampaignMemory(ctx);
    const { powerKey, reason: rawReason } = input as { powerKey: unknown; reason: unknown };
    if (typeof powerKey !== 'string' || !powerKey) throw new Error('powerKey inválido.');
    const reasonOk = validateGrantReason(rawReason);
    if (!reasonOk.ok) throw new Error(reasonOk.error);

    const sheet = ctx.actingCharacter.sheet;
    if (!sheet.classKey) throw new Error('Personagem sem classe.');
    const cls = ctx.config.classes.find((c) => c.key === sheet.classKey);
    if (!cls?.powerKeys.includes(powerKey)) throw new Error('Poder não pertence à classe do personagem.');
    if (sheet.powers.some((p) => p.powerKey === powerKey)) throw new Error('Personagem já conhece este poder.');

    const gate = canMasterGrant({
      evolutionEnabled: ctx.config.evolutionEnabled,
      campaignMessageCount: mem.campaignMessageCount,
      lastMasterGrantAtCampaignMessages: sheet.lastMasterGrantAtCampaignMessages,
      priorGrantCountForCharacter: countGrantsForCharacter(mem.masterGrantLog, ctx.actingCharacter.id),
    });
    if (!gate.ok) throw new Error(gate.error);

    const powers = [...sheet.powers, { powerKey, level: 1 }];
    const updated = await updateCharacterProgress(mem.pool, ctx.actingCharacter.id, {
      powers,
      lastMasterGrantAtCampaignMessages: mem.campaignMessageCount,
    });
    ctx.actingCharacter.sheet = updated.sheet;
    await appendMasterGrantLog(mem.pool, mem.campaignId, {
      at: new Date().toISOString(),
      characterId: ctx.actingCharacter.id,
      type: 'power',
      powerKey,
      reason: reasonOk.reason,
      campaignMessageCount: mem.campaignMessageCount,
    });
    return { granted: true, powerKey, level: 1 };
  },
};

export const ajustarCarteiraTool: ToolDefinition = {
  name: 'ajustar_carteira',
  description:
    'Ajusta o dinheiro do personagem que está agindo (compra, venda, pagamento). Use majorDelta/minorDelta (inteiros, podem ser negativos). Só disponível em campanhas com economia.',
  inputSchema: {
    type: 'object',
    properties: {
      majorDelta: { type: 'number', description: 'Variação da moeda major (ex. ouro).' },
      minorDelta: { type: 'number', description: 'Variação da moeda minor (ex. prata).' },
      reason: { type: 'string', description: 'Motivo (mín. 8 caracteres).' },
    },
    required: ['majorDelta', 'minorDelta', 'reason'],
  },
  execute: async (input, ctx) => {
    const mem = requireCampaignMemory(ctx);
    if (!mem.economyEnabled) throw new Error('Esta campanha não usa economia.');
    const { majorDelta, minorDelta, reason: rawReason } = input as {
      majorDelta: unknown;
      minorDelta: unknown;
      reason: unknown;
    };
    const reasonOk = validateGrantReason(rawReason);
    if (!reasonOk.ok) throw new Error(reasonOk.error);
    if (typeof majorDelta !== 'number' || typeof minorDelta !== 'number') {
      throw new Error('Deltas inválidos.');
    }
    const applied = applyWalletDelta(ctx.actingCharacter.sheet.wallet, majorDelta, minorDelta);
    if (!applied.ok) throw new Error(applied.error);
    const updated = await updateCharacterProgress(mem.pool, ctx.actingCharacter.id, { wallet: applied.wallet });
    ctx.actingCharacter.sheet = updated.sheet;
    await appendMasterGrantLog(mem.pool, mem.campaignId, {
      at: new Date().toISOString(),
      characterId: ctx.actingCharacter.id,
      type: 'wallet',
      majorDelta,
      minorDelta,
      reason: reasonOk.reason,
      campaignMessageCount: mem.campaignMessageCount,
    });
    return {
      wallet: applied.wallet,
      formatted: formatWallet(applied.wallet, mem.currencyNames),
    };
  },
};

export function masterToolsForCampaign(params: {
  economyEnabled: boolean;
  config: ValidatedRulesetConfig;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (params.config.evolutionEnabled) {
    tools.push(concederXpTool, concederPoderTool);
  }
  if (params.economyEnabled) {
    tools.push(ajustarCarteiraTool);
  }
  return tools;
}
