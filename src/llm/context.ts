import type { RecentExchange } from '../db/campaigns-repo';
import type { CurrencyNames } from '../rules-engine';
import { alignMemoryToActingCharacter } from './memory-name-align';

export type CampaignTurnMode = 'normal' | 'perception';

export type PerceptionTier = 'fraco' | 'moderado' | 'agudo' | 'excepcional';

export interface PerceptionPromptContext {
  total: number;
  roll: number;
  attributeValue: number;
  difficulty: number;
  success: boolean;
  tier: PerceptionTier;
  testDie: number;
}

const PERCEPTION_TIER_INSTRUCTIONS: Record<PerceptionTier, string[]> = {
  fraco: [
    '- Tier fraco (total ≤10): a percepção falhou ou foi muito fraca. Descrição VAGA: poucos detalhes, impressões confusas, névoa, distração, ruído ou cansaço — narre a limitação diegeticamente.',
    '- NÃO diga que o jogador "falhou o teste", "tirou baixo" ou mencione mecânica/sistema. Anti-meta absoluto.',
    '- Opções ao final: 1 a 2 caminhos cautelosos, limitados ou parcialmente enganosos (pistas ambíguas). Não ofereça insights precisos.',
  ],
  moderado: [
    '- Tier moderado (total 11–15): percepção útil mas parcial. Detalhes observáveis claros o bastante para agir, sem revelar tudo.',
    '- Opções ao final: 2 a 3 caminhos razoáveis e coerentes com o que foi percebido.',
  ],
  agudo: [
    '- Tier agudo (total 16–19): zoom preciso. Detalhes sensoriais ricos e observáveis (visão, som, cheiro, textura, movimento sutil), ainda sem revelar segredos impossíveis de perceber agora.',
    '- Opções ao final: 3 a 4 caminhos bem informados, específicos e úteis.',
  ],
  excepcional: [
    '- Tier excepcional (total ≥20): percepção excepcional. Zoom muito preciso; detalhes sutis e conexões observáveis que um olhar atento notaria — sem quebrar fog of war nem inventar plot twists grandes.',
    '- Opções ao final: 3 a 4 caminhos excelentes, informados e estratégicos com base no que foi notado.',
  ],
};

/** Extrai ações recentes do jogador (linhas do player) para o bloco anti-ciclo. */
export function formatRecentPlayerMoves(exchanges: RecentExchange[]): string[] {
  return exchanges
    .map((e) => e.playerMessage.trim())
    .filter((msg) => msg.length > 0)
    .map((msg) => (msg.length > 120 ? `${msg.slice(0, 117)}...` : msg));
}

/**
 * Heurística leve: opções numeradas repetidas ou frases-chave muito parecidas
 * nas narrações do mestre → aviso canônico de estagnação.
 */
export function detectCyclicNarration(exchanges: RecentExchange[]): string | null {
  if (exchanges.length < 2) return null;

  const optionSets = exchanges.map((e) => extractOptionFingerprints(e.narration));
  const withOptions = optionSets.filter((s) => s.size > 0);
  if (withOptions.length >= 2) {
    const last = withOptions[withOptions.length - 1]!;
    const prev = withOptions[withOptions.length - 2]!;
    const overlap = [...last].filter((o) => prev.has(o));
    if (overlap.length >= 2 || (last.size > 0 && overlap.length === last.size && last.size === prev.size)) {
      return `Atenção: as últimas trocas estão cíclicas (mesmas opções: ${[...overlap].slice(0, 3).join('; ')}). Proibido repetir; introduza progressão.`;
    }
  }

  const keyPhrases = exchanges.map((e) => normalizeKeyPhrases(e.narration));
  let sharedHits = 0;
  const lastKeys = keyPhrases[keyPhrases.length - 1] ?? new Set<string>();
  for (let i = 0; i < keyPhrases.length - 1; i++) {
    const shared = [...lastKeys].filter((k) => keyPhrases[i]!.has(k));
    if (shared.length >= 2) sharedHits++;
  }
  if (sharedHits >= 1 && exchanges.length >= 3) {
    return 'Atenção: as últimas trocas estão cíclicas (mesmo cenário/frases). Proibido repetir; introduza progressão.';
  }

  return null;
}

function extractOptionFingerprints(narration: string): Set<string> {
  const set = new Set<string>();
  const re = /(?:^|\n)\s*(?:\d+[\).]|[-•])\s*(.+?)(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(narration)) !== null) {
    const norm = m[1]!.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60);
    if (norm.length >= 8) set.add(norm);
  }
  return set;
}

function normalizeKeyPhrases(text: string): Set<string> {
  const set = new Set<string>();
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const chunks = lower.match(/[a-záàâãéêíóôõúç]{4,}(?:\s+[a-záàâãéêíóôõúç]{3,}){2,4}/g) ?? [];
  for (const c of chunks.slice(0, 12)) {
    set.add(c.trim());
  }
  return set;
}

function formatLongTermBlock(params: {
  lore: string;
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
}): string[] {
  const hasFatos = params.fatosCruciais.length > 0;
  const hasRitmo = Boolean(params.ritmoAtual?.trim());
  const hasMarco = Boolean(params.proximoMarco?.trim());
  const hasLore = Boolean(params.lore?.trim());

  const lines = [
    'Contexto de longo prazo (âncoras — use para progressão e consistência):',
    'Lore / cenário estabelecido:',
    hasLore ? params.lore : '(nenhuma lore registrada ainda)',
    '',
    'Fatos cruciais (já estabelecidos — não contradizer):',
    hasFatos
      ? params.fatosCruciais.map((f) => `- ${f}`).join('\n')
      : '(nenhum fato crucial registrado ainda)',
    '',
    'Ritmo atual da cena:',
    hasRitmo ? params.ritmoAtual : '(ainda não avaliado)',
    '',
    'Próximo marco (direção da trama — preferir avançar nesta direção se a cena estagnar):',
    hasMarco ? params.proximoMarco : '(ainda não definido)',
  ];

  if (hasFatos || hasMarco || hasRitmo) {
    lines.push(
      '',
      'Como usar a memória longa: estes itens são âncoras. Short-term = imediato; se o short-term ciclar, avance rumo ao próximo marco / fatos pendentes, sem inventar o que não está aqui.'
    );
  }

  return lines;
}

export function buildSystemPrompt(params: {
  campaignName: string;
  lore: string;
  ritmoAtual: string;
  proximoMarco: string;
  fatosCruciais: string[];
  recentExchanges: RecentExchange[];
  rulesetName: string;
  inCombat?: boolean;
  actingCharacterName: string;
  actingCharacterShortName: string;
  partyCharacters: { name: string; shortName: string }[];
  economyEnabled: boolean;
  currencyNames: CurrencyNames;
  mode?: CampaignTurnMode;
  perceptionCheck?: PerceptionPromptContext;
}): string {
  const short = params.actingCharacterShortName;
  const full = params.actingCharacterName;
  const memory = alignMemoryToActingCharacter({
    recentExchanges: params.recentExchanges,
    fatosCruciais: params.fatosCruciais,
    actingCharacterName: full,
    actingCharacterShortName: short,
  });

  const recentMoves = formatRecentPlayerMoves(memory.recentExchanges);
  const cycleWarning = detectCyclicNarration(memory.recentExchanges);

  const lines = [
    `Você é o mestre de um RPG de mesa chamado "${params.campaignName}", usando o sistema de regras "${params.rulesetName}".`,
    'Narre a aventura de forma envolvente e consistente com o histórico da campanha.',
    '',
    'Hard rules (obrigatórias):',
    '- SEMPRE responda em português brasileiro. Nunca use inglês (exceto nomes próprios se fizer sentido).',
    '- NUNCA mencione: erros internos, ficha faltando, tool falhou, "abordagem alternativa", desculpas técnicas, "sem dados", "não consegui consultar", limitações do sistema, JSON, tools ou prompts.',
    '- Nunca inclua na narração ao jogador tags XML ou marcadores de ferramenta (<tools>, </tools>, <tool_call>, fences ```xml de tool calls, etc.). Ferramentas só via tool_calls estruturados da API — nunca no texto.',
    '- Se faltar informação ou uma ferramenta falhar: improvise na narrativa de forma coerente com a lore e a memória de trabalho, e continue a cena. Não explique o problema.',
    '- Não quebre a 4ª parede. Não fale como assistente — fale só como mestre narrando.',
    '- Sempre que uma ação do jogador tiver resultado incerto, use a ferramenta fazer_teste em vez de inventar um resultado.',
    '- Nunca invente valores de atributos, recursos ou resultados de dado — sempre use as ferramentas disponíveis para isso.',
    '- Nunca invente itens, poderes, XP ou níveis. Mutações mecânicas só via ferramentas ou comandos do bot.',
    `- Personagem do jogador nesta mensagem: ${short} (nome completo: ${full}). Use SEMPRE este nome; NUNCA use outro nome para este jogador (ex.: nunca "Ronaldo" se a ficha é ${short}).`,
    '- Use SOMENTE os nomes canônicos listados abaixo (completo e forma curta). Nunca invente, traduza, substitua ou invente sobrenome ausente na ficha.',
    '- Na prosa casual (ação corrida, diálogo do dia a dia): prefira a forma curta. Use o nome completo em apresentações, formalidade, documentos, ênfase dramática ou ambiguidade entre PCs.',
    '- Você quase nunca concede XP ou poderes. O padrão é NÃO chamar conceder_xp / conceder_poder. Só conceda em decisão significativa + virada de trama. Se em dúvida, não conceda.',
    '- Analise as últimas movimentações/trocas antes de narrar. NÃO repita a mesma situação, as mesmas opções idênticas, nem loops (ex.: sempre "aguardar", "avançar cautelosamente", o mesmo murmúrio).',
    '- Se a cena estiver estagnada ou cíclica: force progressão narrativa (evento, descoberta parcial, mudança de ambiente, NPC age, consequência). Alinhe ao próximo marco e aos fatos cruciais quando existirem. Nunca diga ao jogador que está evitando loop ou "avançando a trama".',
    '- Memória longa (lore, fatos cruciais, ritmo, próximo marco) define o que JÁ foi estabelecido e para onde a trama deve ir. Short-term é o imediato. Se short-term ciclar, avance em direção ao próximo marco / fatos pendentes. Se a memória longa estiver vazia, não invente âncoras; se houver marco/fatos, não contradiga e prefira progressão alinhada.',
  ];
  if (params.economyEnabled) {
    lines.push(
      `- Moedas desta campanha: ${params.currencyNames.major} / ${params.currencyNames.minor} (1 ${params.currencyNames.major} = 10 ${params.currencyNames.minor}).`,
      '- Nunca invente saldo. Ajuste dinheiro só com a ferramenta ajustar_carteira (ou se o jogador já usou /pagar, não debite de novo).'
    );
  } else {
    lines.push('- Esta campanha não usa economia: não narre saldos, preços ou pagamentos mecânicos com moedas.');
  }
  if (params.inCombat) {
    lines.push(
      '- Um combate está em andamento. Use resolver_ataque para resolver ataques contra um alvo, aplicar_dano para aplicar o dano resultante ao alvo certo, e avancar_turno ao final da ação do jogador atual para passar a vez.'
    );
  }
  if (params.mode === 'perception') {
    lines.push(
      '',
      'Modo percepção (obrigatório neste turno):',
      '- O jogador está concentrando a percepção na cena. O teste de percepção JÁ FOI ROLADO pelo sistema; NÃO chame fazer_teste para percepção neste turno.',
      '- Limite-se estritamente ao que a lore, os fatos cruciais e o histórico recente permitem. Não invente plot twists grandes, não revele segredos que o personagem não poderia perceber agora, e não quebre o fog of war.',
      '- Nunca explique mecânica de teste ao jogador (sem "você passou/falhou no teste"). Se a percepção for fraca, narre a limitação (névoa, distração, ruído, etc.).'
    );
    if (params.perceptionCheck) {
      const c = params.perceptionCheck;
      lines.push(
        `- Resultado do teste (só para calibrar a narração; o jogador já viu a rolagem no canal): d${c.testDie} ${c.roll} + atributo ${c.attributeValue} = total ${c.total} vs DC ${c.difficulty} → tier "${c.tier}" (${c.success ? 'sucesso' : 'falha'} vs DC).`,
        ...PERCEPTION_TIER_INSTRUCTIONS[c.tier]
      );
    } else {
      lines.push(
        '- Sem resultado de teste disponível: descreva com detalhes sensoriais moderados e ofereça 2 a 3 opções razoáveis.'
      );
    }
  }

  lines.push('', 'Personagens jogadores nesta campanha (nomes canônicos):');
  if (params.partyCharacters.length === 0) {
    lines.push('(nenhum personagem listado)');
  } else {
    for (const pc of params.partyCharacters) {
      lines.push(`- Completo: "${pc.name}" | Forma curta: "${pc.shortName}"`);
    }
  }
  lines.push(
    '',
    `O personagem do jogador nesta mensagem é: ${full}. Forma curta: ${short}.`,
    `Use SEMPRE "${short}" (ou "${full}" quando formal). Nunca o chame por outro nome. Nunca invente sobrenome. Se o histórico abaixo parecer usar outro nome para este PC, ignore e use "${short}".`,
    '',
    ...formatLongTermBlock({
      lore: params.lore,
      ritmoAtual: params.ritmoAtual,
      proximoMarco: params.proximoMarco,
      fatosCruciais: memory.fatosCruciais,
    }),
    '',
    'Movimentações recentes do jogador (NÃO repita estas situações nem as mesmas opções):',
    recentMoves.length
      ? recentMoves.map((m, i) => `${i + 1}. ${m}`).join('\n')
      : '(nenhuma movimentação recente ainda)',
  );

  if (cycleWarning) {
    lines.push('', cycleWarning);
  }

  lines.push(
    '',
    'Últimas trocas da conversa:',
    memory.recentExchanges.length
      ? memory.recentExchanges.map((e) => `${e.characterName}: ${e.playerMessage}\nMestre: ${e.narration}`).join('\n\n')
      : '(esta é a primeira interação da campanha)',
    '',
    `LEMBRETE FINAL: o PC desta mensagem chama-se ${short}. Narre sobre ${short}. Não use nomes inventados para este jogador.`
  );
  return lines.join('\n');
}
