import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { routeInteraction } from '../../src/bot/interaction-router';
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';

describe('routeInteraction', () => {
  const pool = {} as Pool;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('despacha /criar-campanha para criarCampanha.execute', async () => {
    const spy = vi.spyOn(criarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'criar-campanha',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /criar-personagem para criarPersonagem.execute', async () => {
    const spy = vi.spyOn(criarPersonagem, 'execute').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'criar-personagem',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal criar-personagem:* para criarPersonagem.handleModalSubmit', async () => {
    const spy = vi.spyOn(criarPersonagem, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: 'criar-personagem:abc123:Aria',
    } as any;
    await routeInteraction(interaction, pool);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('ignora comandos desconhecidos sem lançar erro', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      isModalSubmit: () => false,
      commandName: 'comando-desconhecido',
    } as any;
    await expect(routeInteraction(interaction, pool)).resolves.toBeUndefined();
  });
});
