import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import type { Campaign } from '../db/campaigns-repo';
import { PermissionFlagsBits } from 'discord.js';

export function isCampaignOrganizer(interaction: ChatInputCommandInteraction, campaign: Campaign): boolean {
  const userId = interaction.user.id;
  if (campaign.createdByDiscordId && campaign.createdByDiscordId === userId) return true;
  const member = interaction.member as GuildMember | null;
  if (!member?.permissions) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

export async function requireOrganizer(
  interaction: ChatInputCommandInteraction,
  campaign: Campaign
): Promise<boolean> {
  if (isCampaignOrganizer(interaction, campaign)) return true;
  await interaction.reply({
    content: 'Só o organizador da campanha (ou um administrador) pode usar este comando.',
    ephemeral: true,
  });
  return false;
}
