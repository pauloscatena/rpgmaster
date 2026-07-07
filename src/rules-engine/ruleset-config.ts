import { z } from 'zod';
import type { DieSize, RulesetConfig, ValidatedRulesetConfig } from './types';

export const DIE_SIZES: readonly DieSize[] = [4, 6, 8, 10, 12, 20, 100];

const DieSizeSchema = z.union(DIE_SIZES.map((size) => z.literal(size)) as [z.ZodLiteral<DieSize>, z.ZodLiteral<DieSize>, ...z.ZodLiteral<DieSize>[]]);

function joinWithOu(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`;
}

const ResourceDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  startingValue: z.number().int(),
  linkedAttribute: z.string().optional(),
});

export const RulesetConfigSchema = z
  .object({
    name: z.string().min(1),
    attributes: z.array(z.string().min(1)).min(1).max(5),
    testDie: DieSizeSchema,
    resources: z.array(ResourceDefSchema).min(1),
    hpResourceKey: z.string().min(1),
    attackAttribute: z.string().min(1),
    damageDie: DieSizeSchema,
    defenseValue: z.number().int(),
  })
  .superRefine((config, ctx) => {
    if (!config.attributes.includes(config.attackAttribute)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${config.attackAttribute}" não é um atributo válido. Escolha um destes: ${joinWithOu(config.attributes)}.`,
        path: ['attackAttribute'],
      });
    }
    if (!config.resources.some((r) => r.key === config.hpResourceKey)) {
      const resourceKeys = joinWithOu(config.resources.map((r) => r.key));
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${config.hpResourceKey}" não corresponde a nenhum recurso definido. Escolha um destes: ${resourceKeys}.`,
        path: ['hpResourceKey'],
      });
    }
    config.resources.forEach((r, i) => {
      if (r.linkedAttribute && !config.attributes.includes(r.linkedAttribute)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `recurso "${r.key}": "${r.linkedAttribute}" não é um atributo válido. Escolha um destes: ${joinWithOu(config.attributes)}.`,
          path: ['resources', i, 'linkedAttribute'],
        });
      }
    });
  });

export function validateRulesetConfig(
  data: unknown
): { success: true; data: ValidatedRulesetConfig } | { success: false; error: z.ZodError } {
  const result = RulesetConfigSchema.safeParse(data);
  if (result.success) {
    // This is the one legitimate place the `__validated` brand is created:
    // the data just passed the full schema + cross-field validation above.
    return { success: true, data: result.data as ValidatedRulesetConfig };
  }
  return { success: false, error: result.error };
}

export function defaultRulesetConfig(): ValidatedRulesetConfig {
  const literal: RulesetConfig = {
    name: 'Sistema Simplificado Padrão',
    attributes: ['forca', 'destreza', 'intelecto'],
    testDie: 20,
    resources: [{ key: 'hp', label: 'Pontos de Vida', startingValue: 10, linkedAttribute: 'forca' }],
    hpResourceKey: 'hp',
    attackAttribute: 'forca',
    damageDie: 6,
    defenseValue: 12,
  };
  const result = validateRulesetConfig(literal);
  if (!result.success) {
    throw new Error('defaultRulesetConfig produziu uma config inválida — isso é um bug no código.');
  }
  return result.data;
}
