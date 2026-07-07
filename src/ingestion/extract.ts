import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../config';

export interface ExtractionResult {
  lore: string;
  rulesetConfig: unknown;
  clarifyingQuestions: string[];
}

const MODEL = CLAUDE_MODEL;

const EXTRACTION_SYSTEM_PROMPT = [
  'Você extrai informações de documentos de campanhas de RPG de mesa.',
  'Leia o documento e separe duas coisas: a lore/cenário (texto livre) e a configuração de regras (estruturada).',
  'A configuração de regras deve seguir este formato: name (string), attributes (lista de no máximo 5 nomes de atributos), testDie (4, 6, 8, 10, 12, 20 ou 100), resources (lista de { key, label, startingValue, linkedAttribute? }), hpResourceKey (deve corresponder a um resource.key), attackAttribute (deve estar em attributes), damageDie (mesmos valores de testDie), defenseValue (número).',
  'Preencha apenas os campos que puder inferir do documento com confiança — nunca invente um valor.',
  'Se um desses campos estruturais não puder ser inferido, apenas deixe-o de fora do rulesetConfig. O sistema já avisa automaticamente, campo a campo, o que ainda falta — não repita isso em clarifyingQuestions.',
  'Use clarifyingQuestions somente para ambiguidades de interpretação do conteúdo do documento que não sejam simplesmente "faltou preencher um campo" — por exemplo, quando um valor do documento pode ser mapeado de mais de uma forma para o sistema de regras (ex: uma coluna de bônus que pode representar ataque ou dificuldade).',
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
          'Configuração de regras extraída do documento, no formato esperado pelo motor de regras. Preencha apenas o que for possível inferir com confiança.',
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
    max_tokens: 2048,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: documentText }],
    tools: [submeterExtracaoTool],
    tool_choice: { type: 'tool', name: 'submeter_extracao' },
  });

  const block = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submeter_extracao'
  );
  if (!block) {
    throw new Error('O modelo não devolveu uma extração estruturada.');
  }
  return block.input as ExtractionResult;
}

export function buildExtractionInput(documentText: string, clarificationNotes: string): string {
  if (!clarificationNotes) return documentText;
  return `${documentText}\n\nInformações adicionais fornecidas pelo criador da campanha:\n${clarificationNotes}`;
}
