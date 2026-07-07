import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../config';
import { defaultRulesetConfig, validateRulesetConfig, type ValidatedRulesetConfig } from '../rules-engine';

export interface ExtractionResult {
  lore: string;
  rulesetConfig: unknown;
  clarifyingQuestions: string[];
}

const MODEL = CLAUDE_MODEL;

const DEFAULT_RULESET_JSON = JSON.stringify(defaultRulesetConfig());

const EXTRACTION_SYSTEM_PROMPT = [
  'Você extrai informações de documentos de campanhas de RPG de mesa.',
  'Leia o documento e separe duas coisas: a lore/cenário (texto livre) e a configuração de regras (estruturada).',
  'A configuração de regras deve seguir este formato: name (string), attributes (lista de no máximo 5 nomes de atributos), testDie (4, 6, 8, 10, 12, 20 ou 100), resources (lista de { key, label, startingValue, linkedAttribute? }), hpResourceKey (deve corresponder a um resource.key), attackAttribute (deve estar em attributes), damageDie (mesmos valores de testDie), defenseValue (número).',
  'Sempre devolva uma rulesetConfig completa, com todos os campos preenchidos — nunca deixe um campo estrutural de fora. Para cada campo, tente inferir do documento com o máximo de confiança possível; para o que não puder inferir, use o valor correspondente deste sistema de regras padrão como base: ' +
    DEFAULT_RULESET_JSON +
    '.',
  'Use clarifyingQuestions somente para ambiguidades de interpretação do conteúdo do documento — nunca para sinalizar um campo que você preencheu com um valor padrão (isso é esperado e não precisa ser perguntado). Exemplo de ambiguidade real: um valor do documento pode ser mapeado de mais de uma forma para o sistema de regras (ex: uma coluna de bônus que pode representar ataque ou dificuldade), ou um termo do documento (ex: "teste de sanidade") sugere um atributo/recurso que ainda não está definido.',
  'Toda pergunta em clarifyingQuestions deve terminar propondo sua melhor sugestão (com base no que o documento já indica, ou uma convenção razoável de RPG) — nunca deixe uma pergunta totalmente em aberto sem alguma sugestão concreta para o criador aceitar ou corrigir.',
].join('\n');

const submeterExtracaoTool: Anthropic.Tool = {
  name: 'submeter_extracao',
  description: 'Envia a lore extraída e a configuração de regras extraída do documento da campanha.',
  input_schema: {
    type: 'object',
    properties: {
      lore: { type: 'string', description: 'Resumo da história/cenário extraído do documento, em texto livre.' },
      rulesetConfig: {
        type: 'object',
        description:
          'Configuração de regras completa, no formato esperado pelo motor de regras. Todo campo deve estar preenchido — inferido do documento ou copiado do sistema padrão fornecido no prompt.',
      },
      clarifyingQuestions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Perguntas objetivas para o criador da campanha, uma por informação de regra que não pôde ser inferida com confiança. Vazio se a extração de regras estiver completa.',
      },
    },
    required: ['lore', 'rulesetConfig', 'clarifyingQuestions'],
  },
};

export async function extractCampaignDocument(client: Anthropic, documentText: string): Promise<ExtractionResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: documentText }],
    tools: [submeterExtracaoTool],
    tool_choice: { type: 'tool', name: 'submeter_extracao' },
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('O documento é grande ou complexo demais para ser processado em uma única extração.');
  }

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submeter_extracao'
  );
  if (!block) {
    throw new Error('O modelo não devolveu uma extração estruturada.');
  }

  const input = block.input as Record<string, unknown>;
  if (typeof input.lore !== 'string') {
    throw new Error('Extração malformada: campo "lore" ausente ou inválido na resposta do modelo.');
  }
  if (!Array.isArray(input.clarifyingQuestions) || !input.clarifyingQuestions.every((q) => typeof q === 'string')) {
    throw new Error('Extração malformada: campo "clarifyingQuestions" ausente ou inválido na resposta do modelo.');
  }

  return {
    lore: input.lore,
    rulesetConfig: input.rulesetConfig,
    clarifyingQuestions: input.clarifyingQuestions,
  };
}

export function buildExtractionInput(documentText: string, clarificationNotes: string): string {
  if (!clarificationNotes) return documentText;
  return `${documentText}\n\nInformações adicionais fornecidas pelo criador da campanha:\n${clarificationNotes}`;
}

export async function extractResolvedConfig(
  client: Anthropic,
  documentText: string
): Promise<{ lore: string; rulesetConfig: ValidatedRulesetConfig; clarifyingQuestions: string[] }> {
  const extraction = await extractCampaignDocument(client, documentText);
  const validation = validateRulesetConfig(extraction.rulesetConfig);
  return {
    lore: extraction.lore,
    rulesetConfig: validation.success ? validation.data : defaultRulesetConfig(),
    clarifyingQuestions: extraction.clarifyingQuestions,
  };
}
