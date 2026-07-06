import type { validateRulesetConfig } from '../rules-engine';

export function formatValidationIssues(validation: ReturnType<typeof validateRulesetConfig>): string[] {
  if (validation.success) return [];
  return validation.error.issues.map((issue) => `Configuração de regras incompleta: ${issue.message}`);
}
