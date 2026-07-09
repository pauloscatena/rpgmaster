import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  detectCyclicNarration,
  formatRecentPlayerMoves,
} from '../../src/llm/context';
import { FALLBACK_CURRENCY_NAMES } from '../../src/rules-engine';

function baseParams(overrides: Partial<Parameters<typeof buildSystemPrompt>[0]> = {}): Parameters<typeof buildSystemPrompt>[0] {
  return {
    campaignName: 'X',
    lore: '',
    ritmoAtual: '',
    proximoMarco: '',
    fatosCruciais: [],
    recentExchanges: [],
    rulesetName: 'Y',
    actingCharacterName: 'Tess Nightshade',
    actingCharacterShortName: 'Tess',
    partyCharacters: [
      { name: 'Tess Nightshade', shortName: 'Tess' },
      { name: 'Aria Vale', shortName: 'Aria' },
    ],
    economyEnabled: false,
    currencyNames: FALLBACK_CURRENCY_NAMES,
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('inclui o nome da campanha e do sistema de regras', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        campaignName: 'A Torre Esquecida',
        lore: 'Uma torre antiga no meio da floresta.',
        rulesetName: 'Sistema Simplificado Padrão',
      })
    );
    expect(prompt).toContain('A Torre Esquecida');
    expect(prompt).toContain('Sistema Simplificado Padrão');
    expect(prompt).toContain('Uma torre antiga no meio da floresta.');
  });

  it('instrui o modelo a nunca inventar resultados de teste', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toMatch(/nunca invente/i);
  });

  it('inclui Hard rules de PT-BR e anti-meta', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toMatch(/Hard rules/i);
    expect(prompt).toMatch(/português brasileiro/i);
    expect(prompt).toMatch(/Nunca use inglês/i);
    expect(prompt).toMatch(/NUNCA mencione/i);
    expect(prompt).toMatch(/improvise na narrativa/i);
    expect(prompt).toMatch(/4ª parede/i);
    expect(prompt).toContain('"abordagem alternativa"');
    expect(prompt).toMatch(/desculpas técnicas/i);
    expect(prompt).toMatch(/Nunca inclua na narração/i);
    expect(prompt).toContain('<tools>');
  });

  it('usa textos padrão quando lore, fatos e trocas estão vazios', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toContain('nenhuma lore registrada ainda');
    expect(prompt).toContain('nenhum fato crucial registrado ainda');
    expect(prompt).toContain('primeira interação da campanha');
  });

  it('inclui instruções de combate quando inCombat é true', () => {
    const prompt = buildSystemPrompt(baseParams({ inCombat: true }));
    expect(prompt).toMatch(/resolver_ataque/);
    expect(prompt).toMatch(/avancar_turno/);
  });

  it('não menciona ferramentas de combate quando inCombat é false ou omitido', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).not.toMatch(/resolver_ataque/);
  });

  it('inclui fatos cruciais, ritmo atual e próximo marco quando presentes', () => {
    const prompt = buildSystemPrompt(
      baseParams({ fatosCruciais: ['o rei está morto'], ritmoAtual: 'ação', proximoMarco: 'encontrar o goblin' })
    );
    expect(prompt).toContain('o rei está morto');
    expect(prompt).toContain('ação');
    expect(prompt).toContain('encontrar o goblin');
    expect(prompt).toMatch(/Contexto de longo prazo/i);
    expect(prompt).toMatch(/âncoras/i);
    expect(prompt).toMatch(/Como usar a memória longa/i);
  });

  it('inclui as últimas trocas da conversa quando presentes', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        recentExchanges: [{ characterName: 'Aria', playerMessage: 'eu entro na sala', narration: 'Você vê uma sala escura.' }],
      })
    );
    expect(prompt).toContain('Aria: eu entro na sala');
    expect(prompt).toContain('Você vê uma sala escura.');
    expect(prompt).toContain('Movimentações recentes do jogador');
    expect(prompt).toContain('1. eu entro na sala');
  });

  it('inclui hard rules anti-ciclo e progressão via memória longa', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toMatch(/NÃO repita a mesma situação/i);
    expect(prompt).toMatch(/force progressão narrativa/i);
    expect(prompt).toMatch(/Memória longa/i);
    expect(prompt).toMatch(/Nunca diga ao jogador que está evitando loop/i);
  });

  it('injeta aviso quando narrações cíclicas são detectadas', () => {
    const sharedOptions =
      'A floresta permanece quieta.\n1. Aguardar na floresta\n2. Avançar cautelosamente\n3. Investigar o murmúrio';
    const prompt = buildSystemPrompt(
      baseParams({
        recentExchanges: [
          { characterName: 'Tess', playerMessage: 'aguardo', narration: sharedOptions },
          { characterName: 'Tess', playerMessage: 'avanço', narration: sharedOptions },
        ],
      })
    );
    expect(prompt).toMatch(/cíclicas/i);
    expect(prompt).toMatch(/Proibido repetir/i);
  });

  it('injeta nome canônico completo e forma curta do personagem atuante', () => {
    const prompt = buildSystemPrompt(baseParams());
    expect(prompt).toContain('O personagem do jogador nesta mensagem é: Tess Nightshade');
    expect(prompt).toContain('Forma curta: Tess');
    expect(prompt).toContain('Completo: "Tess Nightshade" | Forma curta: "Tess"');
    expect(prompt).toContain('Completo: "Aria Vale" | Forma curta: "Aria"');
    expect(prompt).toMatch(/Nunca invente sobrenome/i);
    expect(prompt).toMatch(/prefira a forma curta/i);
    expect(prompt).toMatch(/Use SEMPRE este nome/i);
    expect(prompt).toMatch(/LEMBRETE FINAL:.*Tess/i);
  });

  it('reescreve alias inventado (Ronaldo) na memória injetada no prompt', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        recentExchanges: [
          {
            characterName: 'Tess',
            playerMessage: '2',
            narration: 'Ronaldo decide colocar as bolsas de volta.',
          },
        ],
        fatosCruciais: ['Ronaldo encontrou três mapas.'],
      })
    );
    expect(prompt).toContain('Tess decide colocar as bolsas de volta.');
    expect(prompt).toContain('Tess encontrou três mapas.');
    expect(prompt).not.toMatch(/Mestre:.*Ronaldo|Fatos.*Ronaldo|encontrou.*Ronaldo/s);
    expect(prompt).toMatch(/nunca "Ronaldo"/i); // hard rule cita o anti-exemplo
  });

  it('omite moedas quando economyEnabled é false', () => {
    const prompt = buildSystemPrompt(baseParams({ economyEnabled: false }));
    expect(prompt).toMatch(/não usa economia/i);
    expect(prompt).not.toContain('Moedas desta campanha');
  });

  it('inclui moedas quando economyEnabled é true', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        economyEnabled: true,
        currencyNames: { major: 'dracmas', minor: 'óbolos' },
      })
    );
    expect(prompt).toContain('Moedas desta campanha: dracmas / óbolos');
  });

  it('inclui instruções de modo percepção quando mode é perception', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        mode: 'perception',
        perceptionCheck: {
          total: 17,
          roll: 14,
          attributeValue: 3,
          difficulty: 12,
          success: true,
          tier: 'agudo',
          testDie: 20,
        },
      })
    );
    expect(prompt).toMatch(/Modo percepção/i);
    expect(prompt).toMatch(/tier "agudo"/i);
    expect(prompt).toMatch(/zoom preciso/i);
    expect(prompt).toMatch(/fog of war/i);
    expect(prompt).toMatch(/3 a 4 caminhos/i);
    expect(prompt).toMatch(/NÃO chame fazer_teste/i);
    expect(prompt).toMatch(/Nunca explique mecânica/i);
  });

  it('calibra opções pelo tier fraco', () => {
    const prompt = buildSystemPrompt(
      baseParams({
        mode: 'perception',
        perceptionCheck: {
          total: 8,
          roll: 5,
          attributeValue: 3,
          difficulty: 12,
          success: false,
          tier: 'fraco',
          testDie: 20,
        },
      })
    );
    expect(prompt).toMatch(/Tier fraco/i);
    expect(prompt).toMatch(/1 a 2 caminhos/i);
    expect(prompt).toMatch(/névoa|distração/i);
  });

  it('não inclui modo percepção quando mode é omitido ou normal', () => {
    expect(buildSystemPrompt(baseParams())).not.toMatch(/Modo percepção/i);
    expect(buildSystemPrompt(baseParams({ mode: 'normal' }))).not.toMatch(/Modo percepção/i);
  });
});

describe('formatRecentPlayerMoves', () => {
  it('lista mensagens do jogador na ordem', () => {
    expect(
      formatRecentPlayerMoves([
        { characterName: 'A', playerMessage: 'entro', narration: 'ok' },
        { characterName: 'A', playerMessage: '  olho  ', narration: 'ok' },
      ])
    ).toEqual(['entro', 'olho']);
  });
});

describe('detectCyclicNarration', () => {
  it('retorna null com poucas trocas ou opções distintas', () => {
    expect(detectCyclicNarration([])).toBeNull();
    expect(
      detectCyclicNarration([
        { characterName: 'A', playerMessage: 'x', narration: '1. Ir à taverna\n2. Falar com o guarda' },
        { characterName: 'A', playerMessage: 'y', narration: '1. Abrir o baú\n2. Descer a escada' },
      ])
    ).toBeNull();
  });

  it('detecta opções numeradas repetidas', () => {
    const opts = '1. Aguardar na floresta\n2. Avançar cautelosamente\n3. Ouvir o murmúrio';
    const warning = detectCyclicNarration([
      { characterName: 'A', playerMessage: 'a', narration: opts },
      { characterName: 'A', playerMessage: 'b', narration: opts },
    ]);
    expect(warning).toMatch(/cíclicas/i);
    expect(warning).toMatch(/Proibido repetir/i);
  });
});
