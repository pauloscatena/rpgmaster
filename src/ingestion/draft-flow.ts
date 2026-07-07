import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { saveDraftProgress, type Campaign } from '../db/campaigns-repo';
import type { ValidatedRulesetConfig } from '../rules-engine';
import * as ingestion from './extract';

export interface DraftAnswerResult {
  message: string;
}

function formatRulesetSummary(config: ValidatedRulesetConfig): string {
  const resourceLines = config.resources
    .map(
      (r) =>
        `${r.label} ("${r.key}", inicial ${r.startingValue}${r.linkedAttribute ? `, ligado a ${r.linkedAttribute}` : ''})`
    )
    .join('; ');
  return [
    `- Nome do sistema: ${config.name}`,
    `- Atributos: ${config.attributes.join(', ')}`,
    `- Dado de teste: d${config.testDie}`,
    `- Recursos: ${resourceLines}`,
    `- Recurso de HP: ${config.hpResourceKey}`,
    `- Atributo de ataque: ${config.attackAttribute}`,
    `- Dado de dano: d${config.damageDie}`,
    `- Valor de defesa: ${config.defenseValue}`,
  ].join('\n');
}

export function formatDraftSummary(campaign: Campaign, clarifyingQuestions: string[]): string {
  const parts = [`Configuração assumida para "${campaign.name}":`, formatRulesetSummary(campaign.rulesetConfig)];
  if (campaign.lore) {
    parts.push(`Lore: ${campaign.lore}`);
  }
  if (clarifyingQuestions.length > 0) {
    parts.push('Ainda tenho dúvidas sobre:\n' + clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'));
  }
  parts.push(
    'Pode responder aqui mesmo no canal com qualquer ajuste, ou rodar `/iniciar-campanha` para aceitar como está e começar.'
  );
  return parts.join('\n\n');
}

export async function processDraftAnswer(
  pool: Pool,
  claudeClient: Anthropic,
  campaign: Campaign,
  answer: string
): Promise<DraftAnswerResult> {
  const updatedNotes = campaign.clarificationNotes ? `${campaign.clarificationNotes}\n${answer}` : answer;
  const combinedInput = ingestion.buildExtractionInput(campaign.sourceDocument, updatedNotes);
  const resolved = await ingestion.extractResolvedConfig(claudeClient, combinedInput);

  const updated = await saveDraftProgress(pool, campaign.id, {
    lore: resolved.lore,
    rulesetConfig: resolved.rulesetConfig,
    clarificationNotes: updatedNotes,
  });

  return { message: formatDraftSummary(updated, resolved.clarifyingQuestions) };
}
