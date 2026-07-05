import { z } from 'zod';
import type { RulesetConfig, ValidatedRulesetConfig } from './types';

const DieSizeSchema = z.union([
  z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(20), z.literal(100),
]);

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
        message: `attackAttribute "${config.attackAttribute}" precisa estar em attributes`,
        path: ['attackAttribute'],
      });
    }
    if (!config.resources.some((r) => r.key === config.hpResourceKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `hpResourceKey "${config.hpResourceKey}" precisa corresponder a um resource.key`,
        path: ['hpResourceKey'],
      });
    }
    config.resources.forEach((r, i) => {
      if (r.linkedAttribute && !config.attributes.includes(r.linkedAttribute)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `resource "${r.key}" linkedAttribute "${r.linkedAttribute}" precisa estar em attributes`,
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
