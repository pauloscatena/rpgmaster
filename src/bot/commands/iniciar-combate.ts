import { randomUUID } from 'node:crypto';
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
import { getCharactersByCampaign } from '../../db/characters-repo';
import { saveCombatState, type CombatCombatant } from '../../db/combat-repo';
import { calcularIniciativa, createCharacterSheet, turnoAtual } from '../../rules-engine';

export const data = new SlashCommandBuilder()
  .setName('iniciar-combate')
  .setDescription('Inicia um combate nesta campanha')
  .addStringOption((opt) => opt.setName('inimigo').setDescription('Nome do inimigo').setRequired(true));

export function buildEnemyModal(campaign: Campaign, enemyName: string): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`iniciar-combate:${campaign.id}:${enemyName}`)
    .setTitle(`Atributos de ${enemyName}`);
  const rows = campaign.rulesetConfig.attributes.map((attr) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId(attr).setLabel(attr).setStyle(TextInputStyle.Short).setRequired(true)
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
  const characters = await getCharactersByCampaign(pool, campaign.id);
  if (characters.length === 0) {
    await interaction.reply({ content: 'Ninguém tem personagem nesta campanha ainda.', ephemeral: true });
    return;
  }
  const inimigo = interaction.options.getString('inimigo', true);
  await interaction.showModal(buildEnemyModal(campaign, inimigo));
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction, pool: Pool): Promise<void> {
  const prefix = 'iniciar-combate:';
  const afterPrefix = interaction.customId.slice(prefix.length);
  const separatorIndex = afterPrefix.indexOf(':');
  const campaignId = separatorIndex === -1 ? afterPrefix : afterPrefix.slice(0, separatorIndex);
  const enemyName = separatorIndex === -1 ? '' : afterPrefix.slice(separatorIndex + 1);
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  if (!guildId || !channelId || !enemyName) return;
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.id !== campaignId) {
    await interaction.reply({ content: 'Campanha não encontrada.', ephemeral: true });
    return;
  }
  const attributeValues: Record<string, number> = {};
  for (const attr of campaign.rulesetConfig.attributes) {
    const raw = interaction.fields.getTextInputValue(attr);
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) {
      await interaction.reply({ content: `Valor inválido para o atributo "${attr}": deve ser um número.`, ephemeral: true });
      return;
    }
    attributeValues[attr] = value;
  }
  const enemySheet = createCharacterSheet(campaign.rulesetConfig, enemyName, attributeValues);
  const characters = await getCharactersByCampaign(pool, campaign.id);

  const combatants: CombatCombatant[] = [
    ...characters.map((c) => ({ id: c.id, name: c.sheet.name, isNpc: false, characterId: c.id, sheet: c.sheet })),
    { id: randomUUID(), name: enemyName, isNpc: true, sheet: enemySheet },
  ];

  const state = calcularIniciativa(
    campaign.rulesetConfig,
    combatants.map((c) => ({ id: c.id, name: c.name, character: c.sheet }))
  );

  await saveCombatState(pool, {
    campaignId: campaign.id,
    combatants,
    order: state.order,
    currentIndex: state.currentIndex,
  });

  const first = turnoAtual(state);
  const ordem = state.order.map((c, i) => `${i + 1}. ${c.name} (iniciativa ${c.initiative})`).join('\n');
  await interaction.reply(`Combate iniciado!\n${ordem}\n\nÉ a vez de **${first.name}**.`);
}
