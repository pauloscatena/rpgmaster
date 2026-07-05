import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../src/llm/context';

describe('buildSystemPrompt', () => {
  it('inclui o nome da campanha e do sistema de regras', () => {
    const prompt = buildSystemPrompt({
      campaignName: 'A Torre Esquecida',
      lore: 'Uma torre antiga no meio da floresta.',
      sessionSummary: '',
      rulesetName: 'Sistema Simplificado Padrão',
    });
    expect(prompt).toContain('A Torre Esquecida');
    expect(prompt).toContain('Sistema Simplificado Padrão');
    expect(prompt).toContain('Uma torre antiga no meio da floresta.');
  });

  it('instrui o modelo a nunca inventar resultados de teste', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y' });
    expect(prompt).toMatch(/nunca invente/i);
  });

  it('usa um texto padrão quando lore e resumo estão vazios', () => {
    const prompt = buildSystemPrompt({ campaignName: 'X', lore: '', sessionSummary: '', rulesetName: 'Y' });
    expect(prompt).toContain('nenhuma lore registrada ainda');
    expect(prompt).toContain('primeira interação da campanha');
  });
});
