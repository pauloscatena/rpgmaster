import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import {
  getCharacterByPlayer,
  updateCharacterBagCapacity,
  updateCharacterInventory,
  updateCharacterProgress,
} from '../../db/characters-repo';
import { addItem, formatWallet } from '../../rules-engine';
import { requireOrganizer } from '../campaign-auth';

async function loadCampaign(interaction: ChatInputCommandInteraction, pool: Pool) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'Este comando só funciona dentro de um servidor.', ephemeral: true });
    return null;
  }
  const campaign = await getCampaignByChannel(pool, guildId, interaction.channelId);
  if (!campaign) {
    await interaction.reply({ content: 'Nenhuma campanha encontrada neste canal.', ephemeral: true });
    return null;
  }
  if (!(await requireOrganizer(interaction, campaign))) return null;
  return campaign;
}

export const concederItemData = new SlashCommandBuilder()
  .setName('conceder-item')
  .setDescription('Organizador: adiciona um item à ficha de um jogador')
  .addUserOption((opt) => opt.setName('jogador').setDescription('Quem recebe').setRequired(true))
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome do item').setRequired(true))
  .addIntegerOption((opt) => opt.setName('qty').setDescription('Quantidade').setRequired(false))
  .addBooleanOption((opt) => opt.setName('usavel').setDescription('Pode usar/consumir').setRequired(false))
  .addBooleanOption((opt) => opt.setName('legivel').setDescription('Pode ler').setRequired(false))
  .addStringOption((opt) => opt.setName('descricao').setDescription('Texto do item').setRequired(false));

export async function executeConcederItem(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const campaign = await loadCampaign(interaction, pool);
  if (!campaign) return;
  const user = interaction.options.getUser('jogador', true);
  const character = await getCharacterByPlayer(pool, campaign.id, user.id);
  if (!character) {
    await interaction.reply({ content: 'Esse jogador não tem personagem.', ephemeral: true });
    return;
  }
  const name = interaction.options.getString('nome', true);
  const qty = interaction.options.getInteger('qty') ?? 1;
  const usable = interaction.options.getBoolean('usavel') ?? true;
  const readable = interaction.options.getBoolean('legivel') ?? false;
  const description = interaction.options.getString('descricao') ?? '';
  const added = addItem(character.sheet.inventory, character.sheet.bagCapacity, {
    name,
    qty,
    usable,
    readable,
    description,
  });
  if (!added.ok) {
    await interaction.reply({ content: added.error, ephemeral: true });
    return;
  }
  await updateCharacterInventory(pool, character.id, added.items);
  await interaction.reply(`Item **${name}** ×${qty} concedido a **${character.sheet.name}**.`);
}

export const concederXpData = new SlashCommandBuilder()
  .setName('conceder-xp')
  .setDescription('Organizador: concede XP (sem limite do Mestre)')
  .addUserOption((opt) => opt.setName('jogador').setDescription('Quem recebe').setRequired(true))
  .addIntegerOption((opt) => opt.setName('quantidade').setDescription('XP').setRequired(true));

export async function executeConcederXp(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const campaign = await loadCampaign(interaction, pool);
  if (!campaign) return;
  const user = interaction.options.getUser('jogador', true);
  const amount = interaction.options.getInteger('quantidade', true);
  if (amount < 1) {
    await interaction.reply({ content: 'Quantidade deve ser ≥ 1.', ephemeral: true });
    return;
  }
  const character = await getCharacterByPlayer(pool, campaign.id, user.id);
  if (!character) {
    await interaction.reply({ content: 'Esse jogador não tem personagem.', ephemeral: true });
    return;
  }
  const xp = character.sheet.xp + amount;
  await updateCharacterProgress(pool, character.id, { xp });
  await interaction.reply(`**${character.sheet.name}** recebeu ${amount} XP (total ${xp}).`);
}

export const concederDinheiroData = new SlashCommandBuilder()
  .setName('conceder-dinheiro')
  .setDescription('Organizador: soma dinheiro à carteira')
  .addUserOption((opt) => opt.setName('jogador').setDescription('Quem recebe').setRequired(true))
  .addIntegerOption((opt) => opt.setName('major').setDescription('Moeda major').setRequired(true))
  .addIntegerOption((opt) => opt.setName('minor').setDescription('Moeda minor').setRequired(true));

export async function executeConcederDinheiro(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const campaign = await loadCampaign(interaction, pool);
  if (!campaign) return;
  if (!campaign.economyEnabled) {
    await interaction.reply({ content: 'Esta campanha não usa economia.', ephemeral: true });
    return;
  }
  const user = interaction.options.getUser('jogador', true);
  const major = interaction.options.getInteger('major', true);
  const minor = interaction.options.getInteger('minor', true);
  if (major < 0 || minor < 0) {
    await interaction.reply({ content: 'Valores devem ser ≥ 0.', ephemeral: true });
    return;
  }
  const character = await getCharacterByPlayer(pool, campaign.id, user.id);
  if (!character) {
    await interaction.reply({ content: 'Esse jogador não tem personagem.', ephemeral: true });
    return;
  }
  const wallet = {
    major: character.sheet.wallet.major + major,
    minor: character.sheet.wallet.minor + minor,
  };
  // normalize via apply with 0 delta after bump — simple floor
  let m = wallet.major;
  let n = wallet.minor;
  if (n >= 10) {
    m += Math.floor(n / 10);
    n = n % 10;
  }
  await updateCharacterProgress(pool, character.id, { wallet: { major: m, minor: n } });
  await interaction.reply(
    `**${character.sheet.name}** agora tem ${formatWallet({ major: m, minor: n }, campaign.currencyNames)}.`
  );
}

export const definirCapacidadeBolsaData = new SlashCommandBuilder()
  .setName('definir-capacidade-bolsa')
  .setDescription('Organizador: define a capacidade da bolsa')
  .addUserOption((opt) => opt.setName('jogador').setDescription('Personagem').setRequired(true))
  .addIntegerOption((opt) => opt.setName('capacidade').setDescription('Slots').setRequired(true));

export async function executeDefinirCapacidadeBolsa(
  interaction: ChatInputCommandInteraction,
  pool: Pool
): Promise<void> {
  const campaign = await loadCampaign(interaction, pool);
  if (!campaign) return;
  const user = interaction.options.getUser('jogador', true);
  const capacity = interaction.options.getInteger('capacidade', true);
  if (capacity < 1) {
    await interaction.reply({ content: 'Capacidade deve ser ≥ 1.', ephemeral: true });
    return;
  }
  const character = await getCharacterByPlayer(pool, campaign.id, user.id);
  if (!character) {
    await interaction.reply({ content: 'Esse jogador não tem personagem.', ephemeral: true });
    return;
  }
  await updateCharacterBagCapacity(pool, character.id, capacity);
  await interaction.reply(`Bolsa de **${character.sheet.name}** agora tem capacidade ${capacity}.`);
}
