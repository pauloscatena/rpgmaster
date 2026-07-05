export type Rng = () => number;

export type DieSize = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface ResourceDef {
  key: string;
  label: string;
  startingValue: number;
  linkedAttribute?: string;
}

export interface RulesetConfig {
  name: string;
  attributes: string[];
  testDie: DieSize;
  resources: ResourceDef[];
  hpResourceKey: string;
  attackAttribute: string;
  damageDie: DieSize;
  defenseValue: number;
}

/**
 * A `RulesetConfig` that has been passed through `validateRulesetConfig` (or
 * built by `defaultRulesetConfig`, which is inherently valid). The `__validated`
 * brand cannot be produced by a plain object literal, so the compiler forces
 * every rules-engine function that requires a validated config to actually
 * receive one of these two sources.
 */
export type ValidatedRulesetConfig = RulesetConfig & { readonly __validated: unique symbol };

export interface CharacterSheet {
  name: string;
  attributes: Record<string, number>;
  resources: Record<string, number>;
  inventory: string[];
}
