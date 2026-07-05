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

export interface CharacterSheet {
  name: string;
  attributes: Record<string, number>;
  resources: Record<string, number>;
  inventory: string[];
}
