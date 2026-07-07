import type { validateRulesetConfig } from '../rules-engine';

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

function describePath(path: (string | number)[]): string {
  const [head, ...rest] = path;
  if (head === undefined) return 'configuração de regras';
  const label = typeof head === 'string' ? (FIELD_LABELS[head] ?? head) : String(head);
  return rest.length === 0 ? label : `${label} (${rest.join('.')})`;
}

export function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[] {
  if (validation.success) return [];
  return validation.error.issues.map((issue) => `Campo "${describePath(issue.path)}": ${issue.message}`);
}
