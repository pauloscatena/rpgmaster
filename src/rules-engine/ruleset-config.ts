import { z } from 'zod';
import type { RulesetConfig } from './types';

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
): { success: true; data: RulesetConfig } | { success: false; error: z.ZodError } {
  const result = RulesetConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as RulesetConfig };
  }
  return { success: false, error: result.error };
}

export function defaultRulesetConfig(): RulesetConfig {
  return {
    name: 'Sistema Simplificado Padrão',
    attributes: ['forca', 'destreza', 'intelecto'],
    testDie: 20,
    resources: [{ key: 'hp', label: 'Pontos de Vida', startingValue: 10, linkedAttribute: 'forca' }],
    hpResourceKey: 'hp',
    attackAttribute: 'forca',
    damageDie: 6,
    defenseValue: 12,
  };
}
