import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extractCampaignDocument, buildExtractionInput, extractResolvedConfig } from '../../src/ingestion/extract';
import { defaultRulesetConfig } from '../../src/rules-engine';

function makeFakeClient(response: unknown): Anthropic {
  const create = vi.fn().mockResolvedValue(response);
  return { messages: { create } } as unknown as Anthropic;
}

describe('extractCampaignDocument', () => {
  it('devolve a extração estruturada a partir do tool_use forçado', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: { name: 'X' }, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractCampaignDocument(client, 'documento de exemplo');
    expect(result).toEqual({ lore: 'Uma torre antiga.', rulesetConfig: { name: 'X' }, clarifyingQuestions: [] });
  });

  it('força a chamada da ferramenta submeter_extracao', async () => {
    const client = makeFakeClient({
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'submeter_extracao', input: { lore: '', rulesetConfig: {}, clarifyingQuestions: [] } },
      ],
    });
    await extractCampaignDocument(client, 'documento de exemplo');
    const callArgs = (client.messages.create as any).mock.calls[0][0];
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'submeter_extracao' });
  });

  it('lança erro quando o modelo não devolve um tool_use', async () => {
    const client = makeFakeClient({ content: [{ type: 'text', text: 'desculpe, não consigo.' }] });
    await expect(extractCampaignDocument(client, 'documento de exemplo')).rejects.toThrow(/extração estruturada/);
  });
});

describe('buildExtractionInput', () => {
  it('devolve o documento original quando não há notas de esclarecimento', () => {
    expect(buildExtractionInput('doc original', '')).toBe('doc original');
  });

  it('anexa as notas de esclarecimento ao documento original', () => {
    const result = buildExtractionInput('doc original', 'O dado é d20.');
    expect(result).toContain('doc original');
    expect(result).toContain('O dado é d20.');
  });
});

describe('extractResolvedConfig', () => {
  const validConfig = {
    name: 'Sistema Caseiro',
    attributes: ['vigor'],
    testDie: 20,
    resources: [{ key: 'hp', label: 'Vida', startingValue: 8, linkedAttribute: 'vigor' }],
    hpResourceKey: 'hp',
    attackAttribute: 'vigor',
    damageDie: 6,
    defenseValue: 11,
  };

  it('devolve a rulesetConfig extraída quando ela é válida', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: validConfig, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.lore).toBe('Uma torre antiga.');
    expect(result.rulesetConfig).toEqual(validConfig);
    expect(result.clarifyingQuestions).toEqual([]);
  });

  it('cai no sistema padrão quando a rulesetConfig extraída falha na validação', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: { lore: 'Uma torre antiga.', rulesetConfig: { name: 'Incompleto' }, clarifyingQuestions: [] },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.rulesetConfig).toEqual(defaultRulesetConfig());
    expect(result.lore).toBe('Uma torre antiga.');
  });

  it('preserva as clarifyingQuestions mesmo quando cai no sistema padrão', async () => {
    const client = makeFakeClient({
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'submeter_extracao',
          input: {
            lore: '',
            rulesetConfig: { name: 'Incompleto' },
            clarifyingQuestions: ['A coluna X representa ataque ou defesa? Sugiro ataque.'],
          },
        },
      ],
    });
    const result = await extractResolvedConfig(client, 'documento de exemplo');
    expect(result.clarifyingQuestions).toEqual(['A coluna X representa ataque ou defesa? Sugiro ataque.']);
  });
});
