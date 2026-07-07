import { DIE_SIZES, type validateRulesetConfig } from '../rules-engine';

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

// Campos com um conjunto fixo de valores válidos: em vez da mensagem genérica
// do Zod ("Invalid input"/"Required"), sugerimos as opções diretamente.
const FIELD_OPTIONS_MESSAGE: Record<string, string> = {
  testDie: `deve ser um destes: ${DIE_OPTIONS}`,
  damageDie: `deve ser um destes: ${DIE_OPTIONS}`,
};

function describePath(path: (string | number)[]): string {
  const [head, ...rest] = path;
  if (head === undefined) return 'configuração de regras';
  const label = typeof head === 'string' ? (FIELD_LABELS[head] ?? head) : String(head);
  return rest.length === 0 ? label : `${label} (${rest.join('.')})`;
}

export function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[] {
  if (validation.success) return [];
  return validation.error.issues.map((issue) => {
    const head = issue.path[0];
    const message = (typeof head === 'string' && FIELD_OPTIONS_MESSAGE[head]) || issue.message;
    return `Campo "${describePath(issue.path)}": ${message}`;
  });
}
