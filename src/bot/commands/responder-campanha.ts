import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { processDraftAnswer } from '../../ingestion/draft-flow';

export const data = new SlashCommandBuilder()
  .setName('responder-campanha')
  .setDescription('Responde às perguntas pendentes sobre o documento da campanha em rascunho')
  .addStringOption((opt) =>
    opt.setName('resposta').setDescription('Sua resposta às perguntas pendentes').setRequired(true)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic
): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'draft') {
    await interaction.reply({
      content: 'Não há campanha em rascunho aguardando respostas neste canal.',
      ephemeral: true,
    });
    return;
  }
  const resposta = interaction.options.getString('resposta', true);

  await interaction.deferReply();

  try {
    const result = await processDraftAnswer(pool, claudeClient, campaign, resposta);
    await interaction.editReply(result.message);
  } catch (err) {
    console.error('Erro ao processar resposta da campanha:', err);
    await interaction.editReply(
      'Não consegui processar sua resposta agora. Tente novamente com `/responder-campanha`.'
    );
  }
}
