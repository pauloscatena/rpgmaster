export type Rng = () => number;

export type DieSize = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface ResourceDef {
  key: string;
  label: string;
  startingValue: number;
  linkedAttribute?: string;
}

export interface PowerDef {
  key: string;
  name: string;
  description: string;
  startingLevel?: number;
}

export interface ClassDef {
  key: string;
  name: string;
  description: string;
  powerKeys: string[];
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
  classes: ClassDef[];
  powers: PowerDef[];
  evolutionEnabled: boolean;
}

/**
 * A `RulesetConfig` that has been passed through `validateRulesetConfig` (or
 * built by `defaultRulesetConfig`, which is inherently valid). The `__validated`
 * brand cannot be produced by a plain object literal, so the compiler forces
 * every rules-engine function that requires a validated config to actually
 * receive one of these two sources.
 */
export type ValidatedRulesetConfig = RulesetConfig & { readonly __validated: unique symbol };

export interface InventoryItem {
  id: string;
  name: string;
  qty: number;
  description: string;
  usable: boolean;
  readable: boolean;
}

export interface CharacterPower {
  powerKey: string;
  level: number;
}

export interface Wallet {
  major: number;
  minor: number;
}

export interface CharacterSheet {
  name: string;
  shortName: string;
  attributes: Record<string, number>;
  resources: Record<string, number>;
  inventory: InventoryItem[];
  bagCapacity: number;
  classKey: string | null;
  xp: number;
  powers: CharacterPower[];
  wallet: Wallet;
  lastMasterGrantAtCampaignMessages: number | null;
}

export interface CurrencyNames {
  major: string;
  minor: string;
}
