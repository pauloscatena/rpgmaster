import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { activateCampaign, getCampaignByChannel, saveDraftProgress } from '../../db/campaigns-repo';
import { defaultRulesetConfig, validateRulesetConfig } from '../../rules-engine';
import * as ingestion from '../../ingestion/extract';
import { formatValidationIssues } from '../../ingestion/validation-messages';

export const data = new SlashCommandBuilder()
  .setName('responder-campanha')
  .setDescription('Responde às perguntas pendentes sobre o documento da campanha em rascunho')
  .addStringOption((opt) =>
    opt.setName('resposta').setDescription('Sua resposta às perguntas pendentes').setRequired(true)
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
  const campaign = await getCampaignByChannel(pool, guildId, channelId);
  if (!campaign || campaign.status !== 'draft') {
    await interaction.reply({
      content: 'Não há campanha em rascunho aguardando respostas neste canal.',
      ephemeral: true,
    });
    return;
  }
  const resposta = interaction.options.getString('resposta', true);
  const updatedNotes = campaign.clarificationNotes ? `${campaign.clarificationNotes}\n${resposta}` : resposta;

  await interaction.deferReply();

  try {
    const combinedInput = ingestion.buildExtractionInput(campaign.sourceDocument, updatedNotes);
    const extraction = await ingestion.extractCampaignDocument(claudeClient, combinedInput);
    const validation = validateRulesetConfig(extraction.rulesetConfig);

    if (extraction.clarifyingQuestions.length === 0 && validation.success) {
      const activated = await activateCampaign(pool, campaign.id, {
        lore: extraction.lore,
        rulesetConfig: validation.data,
      });
      await interaction.editReply(
        `Obrigado! Campanha "${activated.name}" está pronta para jogar. Sistema de regras: ${activated.rulesetConfig.name}.`
      );
      return;
    }

    await saveDraftProgress(pool, campaign.id, {
      lore: extraction.lore,
      rulesetConfig: defaultRulesetConfig(),
      clarificationNotes: updatedNotes,
    });
    const questions = [...extraction.clarifyingQuestions, ...formatValidationIssues(validation)];
    await interaction.editReply(
      'Ainda faltam algumas coisas antes de liberar a campanha:\n' +
        questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
        '\n\nResponda novamente com `/responder-campanha resposta:<sua resposta>`.'
    );
    return;
  } catch (err) {
    console.error('Erro ao processar resposta da campanha:', err);
    await interaction.editReply(
      'Não consegui processar sua resposta agora. Tente novamente com `/responder-campanha`.'
    );
    return;
  }
}
