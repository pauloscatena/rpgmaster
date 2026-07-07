import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel, updateSessionSummary } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import { getCombatState } from '../db/combat-repo';
import type { LlmProvider } from '../llm/provider';
import { fazerTesteTool, consultarFichaTool, type ToolDefinition } from '../llm/tools';
import { resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool } from '../llm/combat-tools';
import { buildSystemPrompt } from '../llm/context';
import { appendToSessionSummary } from '../llm/session-summary';
import { processDraftAnswer } from '../ingestion/draft-flow';
import { turnoAtual } from '../rules-engine';

export async function handleMessage(
  message: Message,
  pool: Pool,
  llmProvider: LlmProvider,
  claudeClient: Anthropic
): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const campaign = await getCampaignByChannel(pool, message.guildId, message.channelId);
  if (!campaign) return;

  if (campaign.status === 'draft') {
    try {
      const result = await processDraftAnswer(pool, claudeClient, campaign, message.content);
      await message.reply(result.message);
    } catch (err) {
      console.error('Erro ao processar resposta da campanha em rascunho:', err);
      try {
        await message.reply('Não consegui processar sua resposta agora. Tente de novo, ou use `/responder-campanha`.');
      } catch (replyErr) {
        console.error('Erro ao enviar mensagem de fallback:', replyErr);
      }
    }
    return;
  }

  if (campaign.status !== 'active') return;

  const character = await getCharacterByPlayer(pool, campaign.id, message.author.id);
  if (!character) {
    await message.reply('Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.');
    return;
  }

  const combatState = await getCombatState(pool, campaign.id);
  let tools: ToolDefinition[] = [fazerTesteTool, consultarFichaTool];
  let combatContext: { pool: Pool; campaignId: string } | undefined;

  if (combatState) {
    const currentCombatant = turnoAtual({ order: combatState.order, currentIndex: combatState.currentIndex });
    const actingCombatant = combatState.combatants.find((c) => c.characterId === character.id);
    if (!actingCombatant || actingCombatant.id !== currentCombatant.id) {
      await message.reply(`Ainda não é sua vez. É a vez de **${currentCombatant.name}**.`);
      return;
    }
    tools = [...tools, resolverAtaqueTool, aplicarDanoTool, avancarTurnoTool];
    combatContext = { pool, campaignId: campaign.id };
  }

  const systemPrompt = buildSystemPrompt({
    campaignName: campaign.name,
    lore: campaign.lore,
    sessionSummary: campaign.sessionSummary,
    rulesetName: campaign.rulesetConfig.name,
    inCombat: Boolean(combatState),
  });

  try {
    const result = await llmProvider.runTurn(systemPrompt, message.content, tools, {
      config: campaign.rulesetConfig,
      actingCharacter: character,
      rng: Math.random,
      combat: combatContext,
    });

    await message.reply(result.narration);

    const exchange = `${character.sheet.name}: ${message.content}\nMestre: ${result.narration}`;
    const updatedSummary = appendToSessionSummary(campaign.sessionSummary, exchange);
    await updateSessionSummary(pool, campaign.id, updatedSummary);
  } catch (err) {
    console.error('Erro ao processar turno do LLM:', err);
    try {
      await message.reply('O mestre teve um problema para responder. Tente novamente em instantes.');
    } catch (replyErr) {
      console.error('Erro ao enviar mensagem de fallback:', replyErr);
    }
  }
}
