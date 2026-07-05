import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig } from '../../rules-engine';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true));

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const existing = await getCampaignByChannel(pool, guildId, channelId);
  if (existing) {
    await interaction.reply({ content: `Já existe uma campanha ativa neste canal: "${existing.name}".`, ephemeral: true });
    return;
  }
  const nome = interaction.options.getString('nome', true);
  const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig() });
  await interaction.reply(`Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.`);
}
