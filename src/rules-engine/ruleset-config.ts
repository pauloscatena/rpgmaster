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

const PowerDefSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  startingLevel: z.number().int().min(1).max(10).optional(),
});

const ClassDefSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  powerKeys: z.array(z.string().min(1)),
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
    classes: z.array(ClassDefSchema).default([]),
    powers: z.array(PowerDefSchema).default([]),
    evolutionEnabled: z.boolean().default(true),
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
    const powerKeys = new Set(config.powers.map((p) => p.key));
    config.classes.forEach((cls, i) => {
      cls.powerKeys.forEach((pk, j) => {
        if (!powerKeys.has(pk)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `classe "${cls.key}": poder "${pk}" não existe no catálogo.`,
            path: ['classes', i, 'powerKeys', j],
          });
        }
      });
    });
  });

export function validateRulesetConfig(
  data: unknown
): { success: true; data: ValidatedRulesetConfig } | { success: false; error: z.ZodError } {
  const result = RulesetConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data as ValidatedRulesetConfig };
  }
  return { success: false, error: result.error };
}

/** Aceita configs antigas sem classes/powers/evolutionEnabled. */
export function coerceRulesetConfig(data: unknown): ValidatedRulesetConfig {
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const withDefaults = {
    ...raw,
    classes: Array.isArray(raw.classes) ? raw.classes : [],
    powers: Array.isArray(raw.powers) ? raw.powers : [],
    evolutionEnabled: typeof raw.evolutionEnabled === 'boolean' ? raw.evolutionEnabled : true,
  };
  const result = validateRulesetConfig(withDefaults);
  if (result.success) return result.data;
  // Fallback seguro: sistema padrão
  return defaultRulesetConfig();
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
    evolutionEnabled: true,
    powers: [
      { key: 'golpe_poderoso', name: 'Golpe Poderoso', description: 'Um ataque devastador.' },
      { key: 'segunda_respiracao', name: 'Segunda Respiração', description: 'Recupera fôlego no calor da batalha.' },
      { key: 'projetil_arcano', name: 'Projétil Arcano', description: 'Dispara energia mágica.' },
      { key: 'escudo_mana', name: 'Escudo de Mana', description: 'Barreira mágica protetora.' },
      { key: 'passo_sombrio', name: 'Passo Sombrio', description: 'Desaparece nas sombras.' },
      { key: 'olho_furtivo', name: 'Olho Furtivo', description: 'Percebe o que outros não veem.' },
    ],
    classes: [
      {
        key: 'guerreiro',
        name: 'Guerreiro',
        description: 'Combatente corpo a corpo.',
        powerKeys: ['golpe_poderoso', 'segunda_respiracao'],
      },
      {
        key: 'arcanista',
        name: 'Arcanista',
        description: 'Manipulador de magia.',
        powerKeys: ['projetil_arcano', 'escudo_mana'],
      },
      {
        key: 'sombra',
        name: 'Sombra',
        description: 'Especialista em furtividade.',
        powerKeys: ['passo_sombrio', 'olho_furtivo'],
      },
    ],
  };
  const result = validateRulesetConfig(literal);
  if (!result.success) {
    throw new Error('defaultRulesetConfig produziu uma config inválida — isso é um bug no código.');
  }
  return result.data;
}
