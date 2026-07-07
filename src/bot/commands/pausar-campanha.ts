import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, pauseCampaign } from '../../db/campaigns-repo';

export const data = new SlashCommandBuilder()
  .setName('pausar-campanha')
  .setDescription('Pausa a sessão em andamento (a configuração permanece travada)');

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
  if (campaign.status === 'draft') {
    await interaction.reply({ content: 'Essa campanha ainda não começou. Use `/iniciar-campanha`.', ephemeral: true });
    return;
  }
  if (campaign.status === 'paused') {
    await interaction.reply({ content: 'Essa campanha já está pausada.', ephemeral: true });
    return;
  }
  await pauseCampaign(pool, campaign.id);
  await interaction.reply(`Campanha "${campaign.name}" pausada. Use \`/retomar-campanha\` quando quiser continuar.`);
}
