import {
  ActionRowBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel, type Campaign } from '../../db/campaigns-repo';
import { createCharacter, getCharacterByPlayer } from '../../db/characters-repo';
import { createCharacterSheet } from '../../rules-engine';

export const MAX_ATTRIBUTE_VALUE = 18;
export const MAX_ATTRIBUTE_POINTS_TOTAL = 30;

const DISCORD_MODAL_TITLE_MAX_LENGTH = 45;

export const data = new SlashCommandBuilder()
  .setName('criar-personagem')
  .setDescription('Cria sua ficha de personagem nesta campanha')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome do personagem').setRequired(true));

export function buildCharacterModal(campaign: Campaign, characterName: string): ModalBuilder {
  const baseTitle = `Atributos de ${characterName}`;
  const titleWithBudget = `${baseTitle} (orçamento: ${MAX_ATTRIBUTE_POINTS_TOTAL})`;
  const title = titleWithBudget.length <= DISCORD_MODAL_TITLE_MAX_LENGTH ? titleWithBudget : baseTitle;
  const modal = new ModalBuilder().setCustomId(`criar-personagem:${campaign.id}:${characterName}`).setTitle(title);
  const rows = campaign.rulesetConfig.attributes.map((attr) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(attr)
        .setLabel(`${attr} (máximo ${MAX_ATTRIBUTE_VALUE})`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
  modal.addComponents(...rows);
  return modal;
}

export async function execute(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'active') {
    await interaction.reply({ content: 'Nenhuma campanha ativa neste canal.', ephemeral: true });
    return;
  }
  const existing = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: `Você já tem um personagem nesta campanha: "${existing.sheet.name}".`,
      ephemeral: true,
    });
    return;
  }
  const nome = interaction.options.getString('nome', true);
  await interaction.showModal(buildCharacterModal(campaign, nome));
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void> {
  const prefix = 'criar-personagem:';
  const afterPrefix = interaction.customId.slice(prefix.length);
  const separatorIndex = afterPrefix.indexOf(':');
  const campaignId = separatorIndex === -1 ? afterPrefix : afterPrefix.slice(0, separatorIndex);
  const nome = separatorIndex === -1 ? '' : afterPrefix.slice(separatorIndex + 1);
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId || !channelId || !nome) return;
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.id !== campaignId) {
    await interaction.reply({ content: 'Campanha não encontrada.', ephemeral: true });
    return;
  }
  const attributeValues: Record<string, number> = {};
  for (const attr of campaign.rulesetConfig.attributes) {
    const raw = interaction.fields.getTextInputValue(attr);
    if (!/^-?\d+$/.test(raw)) {
      await interaction.reply({ content: `Valor inválido para o atributo "${attr}": deve ser um número.`, ephemeral: true });
      return;
    }
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      await interaction.reply({ content: `Valor inválido para o atributo "${attr}": deve ser um número.`, ephemeral: true });
      return;
    }
    if (value > MAX_ATTRIBUTE_VALUE) {
      await interaction.reply({
        content: `Valor inválido para o atributo "${attr}": o máximo permitido é ${MAX_ATTRIBUTE_VALUE}.`,
        ephemeral: true,
      });
      return;
    }
    attributeValues[attr] = value;
  }
  const total = Object.values(attributeValues).reduce((sum, value) => sum + value, 0);
  if (total > MAX_ATTRIBUTE_POINTS_TOTAL) {
    await interaction.reply({
      content: `Total de pontos distribuídos (${total}) ultrapassa o orçamento máximo de ${MAX_ATTRIBUTE_POINTS_TOTAL}.`,
      ephemeral: true,
    });
    return;
  }
  const sheet = createCharacterSheet(campaign.rulesetConfig, nome, attributeValues);
  await createCharacter(pool, { campaignId: campaign.id, playerDiscordId: interaction.user.id, sheet });
  await interaction.reply(`Personagem "${nome}" criado com sucesso!`);
}
