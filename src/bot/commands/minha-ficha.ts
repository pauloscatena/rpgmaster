import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer } from '../../db/characters-repo';
import { formatWallet, usedSlots } from '../../rules-engine';

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
  const sheet = character.sheet;
  const attrLines = Object.entries(sheet.attributes)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const resourceLines = Object.entries(sheet.resources)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');
  const inventoryLine =
    sheet.inventory.length > 0
      ? sheet.inventory.map((i) => `${i.name}×${i.qty}`).join(', ')
      : 'vazio';
  const powersLine =
    sheet.powers.length > 0
      ? sheet.powers.map((p) => `${p.powerKey} (${p.level})`).join(', ')
      : 'nenhum';
  const lines = [
    `**${sheet.name}**${sheet.shortName !== sheet.name ? ` (${sheet.shortName})` : ''}`,
    `Classe: ${sheet.classKey ?? 'nenhuma'} | XP: ${sheet.xp}`,
    `Atributos:\n${attrLines}`,
    `Recursos:\n${resourceLines}`,
    `Inventário (${usedSlots(sheet.inventory)}/${sheet.bagCapacity}): ${inventoryLine}`,
    `Poderes: ${powersLine}`,
  ];
  if (campaign.economyEnabled) {
    lines.push(`Dinheiro: ${formatWallet(sheet.wallet, campaign.currencyNames)}`);
  }
  await interaction.reply({ content: lines.join('\n\n'), ephemeral: !publico });
}
