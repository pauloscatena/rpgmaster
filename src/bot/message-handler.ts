import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, updateSessionSummary } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import type { LlmProvider } from '../llm/provider';
import { fazerTesteTool, consultarFichaTool } from '../llm/tools';
import { buildSystemPrompt } from '../llm/context';
import { appendToSessionSummary } from '../llm/session-summary';

export async function handleMessage(message: Message, pool: Pool, llmProvider: LlmProvider): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const campaign = await getCampaignByChannel(pool, message.guildId, message.channelId);
  if (!campaign || campaign.status !== 'active') return;

  const character = await getCharacterByPlayer(pool, campaign.id, message.author.id);
  if (!character) {
    await message.reply('Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.');
    return;
  }

  const systemPrompt = buildSystemPrompt({
    campaignName: campaign.name,
    lore: campaign.lore,
    sessionSummary: campaign.sessionSummary,
    rulesetName: campaign.rulesetConfig.name,
  });

  try {
    const result = await llmProvider.runTurn(
      systemPrompt,
      message.content,
      [fazerTesteTool, consultarFichaTool],
      { config: campaign.rulesetConfig, actingCharacter: character, rng: Math.random }
    );

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
