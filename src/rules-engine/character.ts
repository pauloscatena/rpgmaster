import type { CharacterSheet, ValidatedRulesetConfig } from './types';

export function createCharacterSheet(
  config: ValidatedRulesetConfig,
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
    let bonus = 0;
    if (resource.linkedAttribute) {
      const linkedValue = attributeValues[resource.linkedAttribute];
      if (linkedValue === undefined) {
        throw new Error(`Falta valor para o atributo "${resource.linkedAttribute}"`);
      }
      bonus = linkedValue;
    }
    resources[resource.key] = resource.startingValue + bonus;
  }

  return {
    name,
    attributes: { ...attributeValues },
    resources,
    inventory: [],
  };
}
