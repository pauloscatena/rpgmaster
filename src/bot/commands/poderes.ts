import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import { getCampaignByChannel } from '../../db/campaigns-repo';
import { getCharacterByPlayer, updateCharacterProgress } from '../../db/characters-repo';
import {
  spendEvolveAttribute,
  spendEvolvePower,
  spendLearnPower,
} from '../../rules-engine';

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

export const poderesData = new SlashCommandBuilder()
  .setName('poderes')
  .setDescription('Lista seus poderes e os da classe');

export async function executePoderes(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const { campaign, character } = ctx;
  const sheet = character.sheet;
  const known =
    sheet.powers.length === 0
      ? '(nenhum)'
      : sheet.powers
          .map((p) => {
            const def = campaign.rulesetConfig.powers.find((d) => d.key === p.powerKey);
            return `- ${def?.name ?? p.powerKey} (nível ${p.level})`;
          })
          .join('\n');
  let available = '(defina uma classe)';
  if (sheet.classKey) {
    const cls = campaign.rulesetConfig.classes.find((c) => c.key === sheet.classKey);
    const keys = (cls?.powerKeys ?? []).filter((k) => !sheet.powers.some((p) => p.powerKey === k));
    available =
      keys.length === 0
        ? '(todos conhecidos)'
        : keys
            .map((k) => {
              const def = campaign.rulesetConfig.powers.find((d) => d.key === k);
              return `- ${def?.name ?? k} (\`${k}\`)`;
            })
            .join('\n');
  }
  await interaction.reply({
    content: [
      `**${sheet.name}** — XP: ${sheet.xp} — Classe: ${sheet.classKey ?? 'nenhuma'}`,
      `Conhecidos:\n${known}`,
      `Ainda não aprendidos:\n${available}`,
    ].join('\n\n'),
    ephemeral: true,
  });
}

export const definirClasseData = new SlashCommandBuilder()
  .setName('definir-classe')
  .setDescription('Define a classe do personagem (uma vez)')
  .addStringOption((opt) => opt.setName('classe').setDescription('Chave da classe (ex: guerreiro)').setRequired(true));

export async function executeDefinirClasse(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  if (ctx.character.sheet.classKey) {
    await interaction.reply({ content: 'Você já tem uma classe. Peça ao organizador para corrigir.', ephemeral: true });
    return;
  }
  const key = interaction.options.getString('classe', true).trim().toLowerCase();
  const cls = ctx.campaign.rulesetConfig.classes.find((c) => c.key === key);
  if (!cls) {
    const keys = ctx.campaign.rulesetConfig.classes.map((c) => c.key).join(', ');
    await interaction.reply({ content: `Classe inválida. Opções: ${keys || '(nenhuma)'}`, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, { classKey: key });
  await interaction.reply(`${ctx.character.sheet.shortName} agora é **${cls.name}**.`);
}

export const aprenderPoderData = new SlashCommandBuilder()
  .setName('aprender-poder')
  .setDescription('Gasta XP para aprender um poder da classe')
  .addStringOption((opt) => opt.setName('poder').setDescription('Chave do poder').setRequired(true));

export async function executeAprenderPoder(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const powerKey = interaction.options.getString('poder', true).trim();
  const result = spendLearnPower(ctx.campaign.rulesetConfig, ctx.character.sheet, powerKey);
  if (!result.ok) {
    await interaction.reply({ content: result.error, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, { xp: result.sheet.xp, powers: result.sheet.powers });
  await interaction.reply(`${ctx.character.sheet.shortName} aprendeu um novo poder (\`${powerKey}\`). XP restante: ${result.sheet.xp}.`);
}

export const evoluirPoderData = new SlashCommandBuilder()
  .setName('evoluir-poder')
  .setDescription('Gasta XP para subir o nível de um poder')
  .addStringOption((opt) => opt.setName('poder').setDescription('Chave do poder').setRequired(true));

export async function executeEvoluirPoder(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const powerKey = interaction.options.getString('poder', true).trim();
  const result = spendEvolvePower(ctx.campaign.rulesetConfig, ctx.character.sheet, powerKey);
  if (!result.ok) {
    await interaction.reply({ content: result.error, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, { xp: result.sheet.xp, powers: result.sheet.powers });
  const lvl = result.sheet.powers.find((p) => p.powerKey === powerKey)?.level;
  await interaction.reply(`${ctx.character.sheet.shortName} evoluiu \`${powerKey}\` para o nível ${lvl}. XP: ${result.sheet.xp}.`);
}

export const evoluirAtributoData = new SlashCommandBuilder()
  .setName('evoluir-atributo')
  .setDescription('Gasta XP para +1 em um atributo')
  .addStringOption((opt) => opt.setName('atributo').setDescription('Nome do atributo').setRequired(true));

export async function executeEvoluirAtributo(interaction: ChatInputCommandInteraction, pool: Pool): Promise<void> {
  const ctx = await load(interaction, pool);
  if (!ctx) return;
  const attribute = interaction.options.getString('atributo', true).trim();
  const result = spendEvolveAttribute(ctx.campaign.rulesetConfig, ctx.character.sheet, attribute);
  if (!result.ok) {
    await interaction.reply({ content: result.error, ephemeral: true });
    return;
  }
  await updateCharacterProgress(pool, ctx.character.id, {
    xp: result.sheet.xp,
    attributes: result.sheet.attributes,
  });
  await interaction.reply(
    `${ctx.character.sheet.shortName}: **${attribute}** agora é ${result.sheet.attributes[attribute]}. XP: ${result.sheet.xp}.`
  );
}
