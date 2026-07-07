import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { createCampaign, getCampaignByChannel } from '../../db/campaigns-repo';
import { defaultRulesetConfig, validateRulesetConfig } from '../../rules-engine';
import { fetchAttachmentText } from '../attachments';
import * as ingestion from '../../ingestion/extract';
import { formatValidationIssues } from '../../ingestion/validation-messages';

export const data = new SlashCommandBuilder()
  .setName('criar-campanha')
  .setDescription('Cria uma nova campanha neste canal')
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome da campanha').setRequired(true))
  .addAttachmentOption((opt) =>
    opt.setName('documento').setDescription('Documento opcional com lore e/ou regras da campanha').setRequired(false)
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  pool: Pool,
  claudeClient: Anthropic
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

  if (!attachment) {
    const campaign = await createCampaign(pool, { guildId, channelId, name: nome, rulesetConfig: defaultRulesetConfig() });
    await interaction.reply(`Campanha "${campaign.name}" criada! Sistema de regras: ${campaign.rulesetConfig.name}.`);
    return;
  }

  await interaction.deferReply();

  try {
    const documentText = await fetchAttachmentText(attachment.url, attachment.name);
    const extraction = await ingestion.extractCampaignDocument(claudeClient, documentText);

    const validation = validateRulesetConfig(extraction.rulesetConfig);

    if (extraction.clarifyingQuestions.length === 0 && validation.success) {
      const campaign = await createCampaign(pool, {
        guildId,
        channelId,
        name: nome,
        rulesetConfig: validation.data,
        lore: extraction.lore,
        sourceDocument: documentText,
      });
      await interaction.editReply(
        `Campanha "${campaign.name}" criada a partir do documento! Sistema de regras: ${campaign.rulesetConfig.name}.`
      );
      return;
    }

    const questions = [...extraction.clarifyingQuestions, ...formatValidationIssues(validation)];
    const campaign = await createCampaign(pool, {
      guildId,
      channelId,
      name: nome,
      rulesetConfig: defaultRulesetConfig(),
      lore: extraction.lore,
      sourceDocument: documentText,
      status: 'draft',
    });
    await interaction.editReply(
      `Recebi o documento, mas preciso confirmar algumas coisas antes de liberar "${campaign.name}" para jogar:\n` +
        questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
        '\n\nResponda com `/responder-campanha resposta:<sua resposta>`.'
    );
    return;
  } catch (err) {
    console.error('Erro ao processar documento da campanha:', err);
    await interaction.editReply(
      'Não consegui processar o documento da campanha. Tente novamente com `/criar-campanha`.'
    );
    return;
  }
}
