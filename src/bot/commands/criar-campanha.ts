import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig } from '../../rules-engine';
import { fetchAttachmentText, UnsupportedAttachmentError } from '../attachments';
import {
  fetchGoogleDocText,
  InvalidGoogleDocsLinkError,
  GoogleDocsPermissionError,
  GoogleDocsNotFoundError,
} from '../google-docs';
import { extractResolvedConfig } from '../../ingestion/extract';
import { formatDraftSummary } from '../../ingestion/draft-flow';
import { generateRandomLore } from '../../ingestion/random-lore';
import { splitDiscordMessage } from '../discord-text';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true))
  .addAttachmentOption((opt) =>
    opt.setName('documento').setDescription('Documento opcional com lore e/ou regras da campanha').setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName('link')
      .setDescription('Link de um Google Docs com a lore e/ou regras da campanha (alternativa ao anexo)')
      .setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic,
  googleServiceAccountKey: string | undefined
): Promise<void> {
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
  const attachment = interaction.options.getAttachment('documento');
  const link = interaction.options.getString('link');

  if (attachment && link) {
    await interaction.reply({
      content: 'Escolha apenas uma origem para o documento da campanha: anexo ou link do Google Docs, não os dois.',
      ephemeral: true,
    });
    return;
  }

  if (link && !googleServiceAccountKey) {
    await interaction.reply({
      content:
        'A referência a Google Docs não está disponível no momento (conta de serviço não configurada). Envie o documento como anexo, ou tente novamente mais tarde.',
      ephemeral: true,
    });
    return;
  }

  if (!attachment && !link) {
    await interaction.deferReply();
    let lore: string;
    try {
      lore = await generateRandomLore(claudeClient);
    } catch (err) {
      console.error('Erro ao gerar lore aleatória:', err);
      lore = 'Uma aventura misteriosa espera para ser descoberta.';
    }
    const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig(), lore });
    await interaction.editReply(
      `Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.\n\n${lore}`
    );
    return;
  }

  await interaction.deferReply();

  try {
    const documentText = link
      ? await fetchGoogleDocText(link, googleServiceAccountKey as string) // link truthy implica googleServiceAccountKey definido (validado acima)
      : await fetchAttachmentText(attachment!.url, attachment!.name);
    const resolved = await extractResolvedConfig(claudeClient, documentText);
    const campaign = await createCampaign(pool, {
      guildId,
      channelId,
      name: nome,
      rulesetConfig: resolved.rulesetConfig,
      lore: resolved.lore,
      sourceDocument: documentText,
      status: 'draft',
    });
    const { first, rest } = splitDiscordMessage(formatDraftSummary(campaign, resolved.clarifyingQuestions));
    await interaction.editReply(first);
    for (const chunk of rest) {
      await interaction.followUp(chunk);
    }
    return;
  } catch (err) {
    if (err instanceof UnsupportedAttachmentError) {
      await interaction.editReply(err.message);
      return;
    }
    if (
      err instanceof InvalidGoogleDocsLinkError ||
      err instanceof GoogleDocsPermissionError ||
      err instanceof GoogleDocsNotFoundError
    ) {
      await interaction.editReply(err.message);
      return;
    }
    console.error('Erro ao processar documento da campanha:', err);
    await interaction.editReply(
      'Não consegui processar o documento da campanha. Tente novamente com `/criar-campanha`.'
    );
    return;
  }
}
