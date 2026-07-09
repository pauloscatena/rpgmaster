import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type { LlmProvider } from '../../llm/provider';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer, updateCharacterAttributes } from '../../db/characters-repo';
import { PERCEPTION_PLAYER_MESSAGE, runActiveCampaignTurn } from '../campaign-turn';
import {
  formatPerceptionRollLine,
  PERCEPTION_ATTRIBUTE,
  rollPerceptionCheck,
} from '../perception-check';

export const data = new SlashCommandBuilder()
  .setName('percepcao')
  .setDescription('Concentra a percepção na cena: o mestre descreve com mais detalhes e reavalia as opções');

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  llmProvider: LlmProvider
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }

  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return;
  }
  if (campaign.status === 'draft') {
    await interaction.reply({
      content: 'Essa campanha ainda não começou. Use `/iniciar-campanha` primeiro.',
      ephemeral: true,
    });
    return;
  }
  if (campaign.status === 'paused') {
    await interaction.reply({
      content: 'Essa campanha está pausada. Use `/retomar-campanha` para continuar.',
      ephemeral: true,
    });
    return;
  }

  const character = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: 'Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.channel || !('sendTyping' in interaction.channel)) {
    await interaction.reply({ content: 'Este comando só funciona em canais de texto.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const wasMissing = character.sheet.attributes[PERCEPTION_ATTRIBUTE] === undefined;
  const check = rollPerceptionCheck(campaign.rulesetConfig, character.sheet);
  if (wasMissing) {
    await updateCharacterAttributes(pool, character.id, character.sheet.attributes);
  }

  const rollLine = formatPerceptionRollLine(check, campaign.rulesetConfig.testDie);
  await interaction.editReply(rollLine);

  const result = await runActiveCampaignTurn({
    pool,
    llmProvider,
    campaign,
    character,
    playerMessage: PERCEPTION_PLAYER_MESSAGE,
    mode: 'perception',
    perceptionCheck: {
      total: check.total,
      roll: check.roll,
      attributeValue: check.attributeValue,
      difficulty: check.difficulty,
      success: check.success,
      tier: check.tier,
      testDie: campaign.rulesetConfig.testDie,
    },
    channel: interaction.channel,
    reply: async (text) => {
      if (interaction.channel && 'send' in interaction.channel) {
        await interaction.channel.send(text);
      } else {
        await interaction.followUp(text);
      }
    },
  });

  if (!result.ok && result.userMessage !== 'turno_falhou') {
    await interaction.followUp(result.userMessage);
  }
}
