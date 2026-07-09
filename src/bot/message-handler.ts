import type { Message } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel } from '../db/campaigns-repo';
import { getCharacterByPlayer } from '../db/characters-repo';
import type { LlmProvider } from '../llm/provider';
import { processDraftAnswer } from '../ingestion/draft-flow';
import { splitDiscordMessage } from './discord-text';
import { runActiveCampaignTurn } from './campaign-turn';
import { detectProfanity, randomProfanityRetort } from './profanity';

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

  if (campaign.status === 'paused') return;

  if (campaign.status === 'draft') {
    try {
      const result = await processDraftAnswer(pool, claudeClient, campaign, message.content);
      const { first, rest } = splitDiscordMessage(result.message);
      await message.reply(first);
      for (const chunk of rest) {
        await message.reply(chunk);
      }
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

  const character = await getCharacterByPlayer(pool, campaign.id, message.author.id);
  if (!character) {
    await message.reply('Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.');
    return;
  }

  if (detectProfanity(message.content) && 'send' in message.channel) {
    await message.channel.send(randomProfanityRetort()).catch(() => {});
  }

  const result = await runActiveCampaignTurn({
    pool,
    llmProvider,
    campaign,
    character,
    playerMessage: message.content,
    channel: message.channel,
    reply: async (text) => {
      await message.reply(text);
    },
  });

  if (!result.ok && result.userMessage !== 'turno_falhou') {
    await message.reply(result.userMessage);
  }
}
