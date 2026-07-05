import type { CharacterSheet, RulesetConfig } from './types';

export function createCharacterSheet(
  config: RulesetConfig,
  name: string,
  attributeValues: Record<string, number>
): CharacterSheet {
  for (const attr of config.attributes) {
    if (!(attr in attributeValues)) {
      throw new Error(`Falta valor para o atributo "${attr}"`);
    }
  }

  const resources: Record<string, number> = {};
  for (const resource of config.resources) {
    const bonus = resource.linkedAttribute ? attributeValues[resource.linkedAttribute] : 0;
    resources[resource.key] = resource.startingValue + bonus;
  }

  return {
    name,
    attributes: { ...attributeValues },
    resources,
    inventory: [],
  };
}
