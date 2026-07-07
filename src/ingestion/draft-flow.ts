import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { activateCampaign, saveDraftProgress, type Campaign } from '../db/campaigns-repo';
import { defaultRulesetConfig, validateRulesetConfig } from '../rules-engine';
import * as ingestion from './extract';
import { formatValidationIssues } from './validation-messages';

export interface DraftAnswerResult {
  activated: boolean;
  message: string;
}

export async function processDraftAnswer(
  pool: Pool,
  claudeClient: Anthropic,
  campaign: Campaign,
  answer: string
): Promise<DraftAnswerResult> {
  const updatedNotes = campaign.clarificationNotes ? `${campaign.clarificationNotes}\n${answer}` : answer;
  const combinedInput = ingestion.buildExtractionInput(campaign.sourceDocument, updatedNotes);
  const extraction = await ingestion.extractCampaignDocument(claudeClient, combinedInput);
  const validation = validateRulesetConfig(extraction.rulesetConfig);

  if (extraction.clarifyingQuestions.length === 0 && validation.success) {
    const activated = await activateCampaign(pool, campaign.id, {
      lore: extraction.lore,
      rulesetConfig: validation.data,
    });
    return {
      activated: true,
      message: `Obrigado! Campanha "${activated.name}" está pronta para jogar. Sistema de regras: ${activated.rulesetConfig.name}.`,
    };
  }

  await saveDraftProgress(pool, campaign.id, {
    lore: extraction.lore,
    rulesetConfig: defaultRulesetConfig(),
    clarificationNotes: updatedNotes,
  });
  const questions = [...extraction.clarifyingQuestions, ...formatValidationIssues(validation)];
  return {
    activated: false,
    message:
      'Ainda faltam algumas coisas antes de liberar a campanha:\n' +
      questions.map((q, i) => `${i + 1}. ${q}`).join('\n') +
      '\n\nPode responder aqui mesmo no canal, com o que faltar.',
  };
}
