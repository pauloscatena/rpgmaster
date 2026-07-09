import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer, updateCharacterInventory } from '../../db/characters-repo';
import { findItem, formatWallet, removeItem, transferItem, usedSlots } from '../../rules-engine';

async function loadPlayer(interaction: ChatInputCommandInteraction, pool: Pool) {
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
  const character = await getCharacterByPlayer(pool, campaign.id, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: 'Você ainda não tem um personagem nesta campanha. Use `/criar-personagem` primeiro.',
      ephemeral: true,
    });
    return null;
  }
  return { campaign, character };
}

export const inventarioData = new SlashCommandBuilder()
  .setName('inventario')
  .setDescription('Mostra sua bolsa e itens')
  .addBooleanOption((opt) =>
    opt.setName('publico').setDescription('Mostrar para todos no canal').setRequired(false)
  );

export async function executeInventario(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await loadPlayer(interaction, pool);
  if (!ctx) return;
  const { campaign, character } = ctx;
  const sheet = character.sheet;
  const slots = usedSlots(sheet.inventory);
  const items =
    sheet.inventory.length === 0
      ? 'vazio'
      : sheet.inventory.map((i) => `- ${i.name} ×${i.qty}`).join('\n');
  const lines = [
    `**Bolsa de ${sheet.name}** (${slots}/${sheet.bagCapacity})`,
    items,
  ];
  if (campaign.economyEnabled) {
    lines.push(`Dinheiro: ${formatWallet(sheet.wallet, campaign.currencyNames)}`);
  }
  const publico = interaction.options.getBoolean('publico') ?? false;
  await interaction.reply({ content: lines.join('\n'), ephemeral: !publico });
}

export const usarData = new SlashCommandBuilder()
  .setName('usar')
  .setDescription('Usa (consome) um item usável da bolsa')
  .addStringOption((opt) => opt.setName('item').setDescription('Nome ou id do item').setRequired(true));

export async function executeUsar(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await loadPlayer(interaction, pool);
  if (!ctx) return;
  const itemRef = interaction.options.getString('item', true);
  const found = findItem(ctx.character.sheet.inventory, itemRef);
  if (!found) {
    await interaction.reply({ content: `Item "${itemRef}" não encontrado.`, ephemeral: true });
    return;
  }
  if (!found.usable) {
    await interaction.reply({ content: `"${found.name}" não é usável.`, ephemeral: true });
    return;
  }
  const removed = removeItem(ctx.character.sheet.inventory, found.id, 1);
  if (!removed.ok) {
    await interaction.reply({ content: removed.error, ephemeral: true });
    return;
  }
  await updateCharacterInventory(pool, ctx.character.id, removed.items);
  await interaction.reply(`${ctx.character.sheet.shortName} usa **${found.name}**.`);
}

export const lerData = new SlashCommandBuilder()
  .setName('ler')
  .setDescription('Lê a descrição de um item legível')
  .addStringOption((opt) => opt.setName('item').setDescription('Nome ou id do item').setRequired(true));

export async function executeLer(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await loadPlayer(interaction, pool);
  if (!ctx) return;
  const itemRef = interaction.options.getString('item', true);
  const found = findItem(ctx.character.sheet.inventory, itemRef);
  if (!found) {
    await interaction.reply({ content: `Item "${itemRef}" não encontrado.`, ephemeral: true });
    return;
  }
  if (!found.readable) {
    await interaction.reply({ content: `"${found.name}" não é legível.`, ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `**${found.name}:** ${found.description || '(sem texto)'}`,
    ephemeral: true,
  });
}

export const darData = new SlashCommandBuilder()
  .setName('dar')
  .setDescription('Dá um item a outro jogador')
  .addStringOption((opt) => opt.setName('item').setDescription('Nome ou id do item').setRequired(true))
  .addUserOption((opt) => opt.setName('jogador').setDescription('Quem recebe').setRequired(true))
  .addIntegerOption((opt) => opt.setName('qty').setDescription('Quantidade').setRequired(false));

export async function executeDar(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await loadPlayer(interaction, pool);
  if (!ctx) return;
  const itemRef = interaction.options.getString('item', true);
  const targetUser = interaction.options.getUser('jogador', true);
  const qty = interaction.options.getInteger('qty') ?? 1;
  const target = await getCharacterByPlayer(pool, ctx.campaign.id, targetUser.id);
  if (!target) {
    await interaction.reply({ content: 'O alvo não tem personagem nesta campanha.', ephemeral: true });
    return;
  }
  const result = transferItem(
    ctx.character.sheet.inventory,
    target.sheet.inventory,
    target.sheet.bagCapacity,
    itemRef,
    qty
  );
  if (!result.ok) {
    await interaction.reply({ content: result.error, ephemeral: true });
    return;
  }
  await updateCharacterInventory(pool, ctx.character.id, result.from);
  await updateCharacterInventory(pool, target.id, result.to);
  await interaction.reply(
    `${ctx.character.sheet.shortName} dá ${qty}× item a **${target.sheet.name}**.`
  );
}

export const jogarForaData = new SlashCommandBuilder()
  .setName('jogar-fora')
  .setDescription('Descarta um item da bolsa')
  .addStringOption((opt) => opt.setName('item').setDescription('Nome ou id do item').setRequired(true))
  .addIntegerOption((opt) => opt.setName('qty').setDescription('Quantidade').setRequired(false));

export async function executeJogarFora(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await loadPlayer(interaction, pool);
  if (!ctx) return;
  const itemRef = interaction.options.getString('item', true);
  const qty = interaction.options.getInteger('qty') ?? 1;
  const removed = removeItem(ctx.character.sheet.inventory, itemRef, qty);
  if (!removed.ok) {
    await interaction.reply({ content: removed.error, ephemeral: true });
    return;
  }
  await updateCharacterInventory(pool, ctx.character.id, removed.items);
  await interaction.reply(`${ctx.character.sheet.shortName} joga fora ${qty}× **${removed.removed.name}**.`);
}
