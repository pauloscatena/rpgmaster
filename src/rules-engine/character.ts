import type { CharacterSheet, Rng, ValidatedRulesetConfig } from './types';
import { defaultShortName } from './character-names';

/** Faixa usada ao assumir atributo ausente (criação ou primeiro uso). */
export const ASSUMED_ATTRIBUTE_MIN = 1;
export const ASSUMED_ATTRIBUTE_MAX = 10;

export function rollAssumedAttribute(rng: Rng = Math.random): number {
  const span = ASSUMED_ATTRIBUTE_MAX - ASSUMED_ATTRIBUTE_MIN + 1;
  return Math.floor(rng() * span) + ASSUMED_ATTRIBUTE_MIN;
}

/**
 * Resolve o valor de um atributo. Se estiver ausente, sorteia 1..10, grava na ficha
 * (persistência em memória) e devolve — sem lançar erro.
 */
export function resolveAttributeValue(
  character: CharacterSheet,
  attribute: string,
  rng: Rng = Math.random
): number {
  const value = character.attributes[attribute];
  if (value !== undefined) {
    return value;
  }

  const assumed = rollAssumedAttribute(rng);
  character.attributes[attribute] = assumed;
  console.warn(
    `Atributo "${attribute}" ausente na ficha de "${character.name}"; assumindo ${assumed}.`
  );
  return assumed;
}

export function createCharacterSheet(
  config: ValidatedRulesetConfig,
  name: string,
  attributeValues: Record<string, number>,
  rng: Rng = Math.random
): CharacterSheet {
  const trimmedName = name.trim().slice(0, 80);
  const attributes: Record<string, number> = { ...attributeValues };
  for (const attr of config.attributes) {
    if (!(attr in attributes)) {
      attributes[attr] = rollAssumedAttribute(rng);
    }
  }

  const resources: Record<string, number> = {};
  for (const resource of config.resources) {
    const bonus = resource.linkedAttribute ? (attributes[resource.linkedAttribute] ?? 0) : 0;
    resources[resource.key] = resource.startingValue + bonus;
  }

  return {
    name: trimmedName,
    shortName: defaultShortName(trimmedName).slice(0, 40),
    attributes,
    resources,
    inventory: [],
    bagCapacity: 10,
    classKey: null,
    xp: 0,
    powers: [],
    wallet: { major: 0, minor: 0 },
    lastMasterGrantAtCampaignMessages: null,
  };
}
