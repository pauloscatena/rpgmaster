import { describe, it, expect } from 'vitest';
import { resolverAtaque, aplicarDano } from '../../src/rules-engine/combat';
import { createCharacterSheet } from '../../src/rules-engine/character';
import { defaultRulesetConfig } from '../../src/rules-engine/ruleset-config';

describe('resolverAtaque', () => {
  const config = defaultRulesetConfig(); // attackAttribute: forca, defenseValue: 12, damageDie: 6
  const attacker = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });

  it('acerta quando o teste de ataque bate a defesa e rola dano', () => {
    // rng sequence: primeira chamada = teste de ataque (d20, rng=0.5 -> 11 + forca 3 = 14 >= 12)
    // segunda chamada = dado de dano (d6, rng=0.5 -> 4) + forca 3 = 7
    const calls = [0.5, 0.5];
    let i = 0;
    const rng = () => calls[i++];
    const result = resolverAtaque(config, attacker, rng);
    expect(result.hit).toBe(true);
    expect(result.check.total).toBe(14);
    expect(result.damage).toBe(7);
  });

  it('erra e não rola dano quando o teste de ataque não bate a defesa', () => {
    const rng = () => 0; // d20 rng=0 -> roll 1 + forca 3 = 4 < 12
    const result = resolverAtaque(config, attacker, rng);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });
});

describe('aplicarDano', () => {
  const config = defaultRulesetConfig();
  const defender = createCharacterSheet(config, 'Goblin', { forca: 1, destreza: 1, intelecto: 1 });

  it('subtrai o dano do recurso de HP', () => {
    const updated = aplicarDano(config, defender, 5);
    expect(updated.resources.hp).toBe(defender.resources.hp - 5);
  });

  it('não deixa o recurso de HP ficar negativo', () => {
    const updated = aplicarDano(config, defender, 999);
    expect(updated.resources.hp).toBe(0);
  });

  it('não muta a ficha original', () => {
    const originalHp = defender.resources.hp;
    aplicarDano(config, defender, 5);
    expect(defender.resources.hp).toBe(originalHp);
  });
});
