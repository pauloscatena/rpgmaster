import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, activateCampaign } from '../../db/campaigns-repo';

export const data = new SlashCommandBuilder()
  .setName('retomar-campanha')
  .setDescription('Retoma uma sessão pausada');

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
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
  if (campaign.status === 'active') {
    await interaction.reply({ content: 'Essa campanha já está em andamento.', ephemeral: true });
    return;
  }
  if (campaign.status === 'draft') {
    await interaction.reply({ content: 'Essa campanha ainda não começou. Use `/iniciar-campanha`.', ephemeral: true });
    return;
  }
  await activateCampaign(pool, campaign.id);
  await interaction.reply(`Campanha "${campaign.name}" retomada — bem-vindos de volta!`);
}
