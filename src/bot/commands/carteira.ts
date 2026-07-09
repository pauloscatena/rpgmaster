import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer, updateCharacterProgress } from '../../db/characters-repo';
import { applyWalletDelta, formatWallet, totalMinor } from '../../rules-engine';

const NO_ECONOMY = 'Esta campanha não usa economia.';

async function load(interaction: ChatInputCommandInteraction, pool: Pool) {
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
  if (!campaign.economyEnabled) {
    await interaction.reply({ content: NO_ECONOMY, ephemeral: true });
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

export const carteiraData = new SlashCommandBuilder()
  .setName('carteira')
  .setDescription('Mostra seu dinheiro')
  .addBooleanOption((opt) =>
    opt.setName('publico').setDescription('Mostrar para todos').setRequired(false)
  );

export async function executeCarteira(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const publico = interaction.options.getBoolean('publico') ?? false;
  await interaction.reply({
    content: `**${ctx.character.sheet.name}:** ${formatWallet(ctx.character.sheet.wallet, ctx.campaign.currencyNames)}`,
    ephemeral: !publico,
  });
}

export const pagarData = new SlashCommandBuilder()
  .setName('pagar')
  .setDescription('Gasta dinheiro (NPC/custo)')
  .addIntegerOption((opt) => opt.setName('major').setDescription('Moeda major').setRequired(true))
  .addIntegerOption((opt) => opt.setName('minor').setDescription('Moeda minor').setRequired(true));

export async function executePagar(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const major = interaction.options.getInteger('major', true);
  const minor = interaction.options.getInteger('minor', true);
  if (major < 0 || minor < 0) {
    await interaction.reply({ content: 'Valores devem ser ≥ 0.', ephemeral: true });
    return;
  }
  const applied = applyWalletDelta(ctx.character.sheet.wallet, -major, -minor);
  if (!applied.ok) {
    await interaction.reply({ content: applied.error, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, { wallet: applied.wallet });
  await interaction.reply(
    `${ctx.character.sheet.shortName} paga ${formatWallet({ major, minor }, ctx.campaign.currencyNames)}. Resta: ${formatWallet(applied.wallet, ctx.campaign.currencyNames)}.`
  );
}

export const darDinheiroData = new SlashCommandBuilder()
  .setName('dar-dinheiro')
  .setDescription('Transfere dinheiro para outro jogador')
  .addUserOption((opt) => opt.setName('jogador').setDescription('Quem recebe').setRequired(true))
  .addIntegerOption((opt) => opt.setName('major').setDescription('Moeda major').setRequired(true))
  .addIntegerOption((opt) => opt.setName('minor').setDescription('Moeda minor').setRequired(true));

export async function executeDarDinheiro(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const targetUser = interaction.options.getUser('jogador', true);
  const major = interaction.options.getInteger('major', true);
  const minor = interaction.options.getInteger('minor', true);
  if (major < 0 || minor < 0 || (major === 0 && minor === 0)) {
    await interaction.reply({ content: 'Informe um valor positivo.', ephemeral: true });
    return;
  }
  const target = await getCharacterByPlayer(pool, ctx.campaign.id, targetUser.id);
  if (!target) {
    await interaction.reply({ content: 'O alvo não tem personagem nesta campanha.', ephemeral: true });
    return;
  }
  if (totalMinor(ctx.character.sheet.wallet) < major * 10 + minor) {
    await interaction.reply({ content: 'Saldo insuficiente.', ephemeral: true });
    return;
  }
  const from = applyWalletDelta(ctx.character.sheet.wallet, -major, -minor);
  if (!from.ok) {
    await interaction.reply({ content: from.error, ephemeral: true });
    return;
  }
  const to = applyWalletDelta(target.sheet.wallet, major, minor);
  if (!to.ok) {
    await interaction.reply({ content: to.error, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, { wallet: from.wallet });
  await updateCharacterProgress(pool, target.id, { wallet: to.wallet });
  await interaction.reply(
    `${ctx.character.sheet.shortName} dá dinheiro a **${target.sheet.name}**.`
  );
}
