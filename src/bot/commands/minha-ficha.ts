import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer } from '../../db/characters-repo';

export const data = new SlashCommandBuilder()
  .setName('minha-ficha')
  .setDescription('Mostra sua ficha de personagem nesta campanha')
  .addBooleanOption((opt) =>
    opt.setName('publico').setDescription('Mostrar a ficha para todos no canal (padrão: só você vê)').setRequired(false)
  );

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
  const character = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: 'Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.',
      ephemeral: true,
    });
    return;
  }
  const publico = interaction.options.getBoolean('publico') ?? false;
  const attrLines = Object.entries(character.sheet.attributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const resourceLines = Object.entries(character.sheet.resources)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const inventoryLine = character.sheet.inventory.length > 0 ? character.sheet.inventory.join(', ') : 'vazio';
  const content = [
    `**${character.sheet.name}**`,
    `Atributos:\n${attrLines}`,
    `Recursos:\n${resourceLines}`,
    `Inventário: ${inventoryLine}`,
  ].join('\n\n');
  await interaction.reply({ content, ephemeral: !publico });
}
