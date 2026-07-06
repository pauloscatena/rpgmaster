export function buildSystemPrompt(params: {
  campaignName: string;
  lore: string;
  sessionSummary: string;
  rulesetName: string;
  inCombat?: boolean;
}): string {
  const lines = [
    `Você é o mestre de um RPG de mesa chamado "${params.campaignName}", usando o sistema de regras "${params.rulesetName}".`,
    'Narre a aventura de forma envolvente e consistente com o histórico da campanha.',
    'Sempre que uma ação do jogador tiver resultado incerto, use a ferramenta fazer_teste em vez de inventar um resultado.',
    'Nunca invente valores de atributos, recursos ou resultados de dado — sempre use as ferramentas disponíveis para isso.',
  ];
  if (params.inCombat) {
    lines.push(
      'Um combate está em andamento. Use resolver_ataque para resolver ataques contra um alvo, aplicar_dano para aplicar o dano resultante ao alvo certo, e avancar_turno ao final da ação do jogador atual para passar a vez.'
    );
  }
  lines.push(
    '',
    'Cenário e história até agora:',
    params.lore || '(nenhuma lore registrada ainda)',
    '',
    'Resumo da sessão até o momento:',
    params.sessionSummary || '(esta é a primeira interação da campanha)'
  );
  return lines.join('\n');
}
