import { DIE_SIZES, defaultRulesetConfig, type validateRulesetConfig } from '../rules-engine';

const FIELD_LABELS: Record<string, string> = {
  name: 'nome do sistema',
  attributes: 'atributos',
  testDie: 'dado de teste',
  resources: 'recursos',
  hpResourceKey: 'recurso de HP',
  attackAttribute: 'atributo de ataque',
  damageDie: 'dado de dano',
  defenseValue: 'valor de defesa',
};

function joinWithOu(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`;
}

const DIE_OPTIONS = joinWithOu(DIE_SIZES.map((size) => `d${size}`));
const USE_DEFAULT_HINT = 'ou responda "usar padrão"';
const DEFAULTS = defaultRulesetConfig();

// Campos com um conjunto fixo de valores válidos: em vez da mensagem genérica
// do Zod ("Invalid input"), sugerimos as opções diretamente.
const FIELD_OPTIONS_MESSAGE: Record<string, string> = {
  testDie: `deve ser um destes: ${DIE_OPTIONS}`,
  damageDie: `deve ser um destes: ${DIE_OPTIONS}`,
};

// Campos sem um conjunto fixo de valores: quando estão totalmente ausentes
// ("Required"), sugerimos um exemplo concreto em vez de deixar a pergunta em
// aberto, com a opção de simplesmente aceitar o sistema padrão.
const FIELD_MISSING_SUGGESTION: Record<string, string> = {
  name: `não informado. Sugestão: dê um nome curto ao sistema (ex: "${DEFAULTS.name}"), ${USE_DEFAULT_HINT}.`,
  attributes: `não informado. Sugestão: liste de 1 a 5 atributos (ex: ${joinWithOu(DEFAULTS.attributes)}), ${USE_DEFAULT_HINT}.`,
  resources: `não informado. Sugestão: liste os recursos com valor inicial (ex: ${DEFAULTS.resources.map((r) => `${r.label} ("${r.key}", valor inicial ${r.startingValue})`).join('; ')}), ${USE_DEFAULT_HINT}.`,
  hpResourceKey: `não informado. Sugestão: use a chave de um dos recursos que representa vida (ex: "${DEFAULTS.hpResourceKey}"), ${USE_DEFAULT_HINT}.`,
  attackAttribute: `não informado. Sugestão: use um dos atributos que representa ataque (ex: "${DEFAULTS.attackAttribute}"), ${USE_DEFAULT_HINT}.`,
  defenseValue: `não informado. Sugestão: um número para a dificuldade padrão de acertar um personagem (ex: ${DEFAULTS.defenseValue}), ${USE_DEFAULT_HINT}.`,
};

function describePath(path: (string | number)[]): string {
  const [head, ...rest] = path;
  if (head === undefined) return 'configuração de regras';
  const label = typeof head === 'string' ? (FIELD_LABELS[head] ?? head) : String(head);
  return rest.length === 0 ? label : `${label} (${rest.join('.')})`;
}

function describeMessage(issue: { path: (string | number)[]; message: string }): string {
  const head = issue.path[0];
  if (typeof head !== 'string') return issue.message;
  if (FIELD_OPTIONS_MESSAGE[head]) return FIELD_OPTIONS_MESSAGE[head];
  if (issue.message === 'Required' && FIELD_MISSING_SUGGESTION[head]) return FIELD_MISSING_SUGGESTION[head];
  return issue.message;
}

export function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[] {
  if (validation.success) return [];
  return validation.error.issues.map((issue) => `Campo "${describePath(issue.path)}": ${describeMessage(issue)}`);
}
