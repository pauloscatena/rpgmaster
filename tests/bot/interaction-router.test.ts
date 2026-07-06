import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { routeInteraction } from '../../src/bot/interaction-router';
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';
import * as iniciarCombate from '../../src/bot/commands/iniciar-combate';
import * as responderCampanha from '../../src/bot/commands/responder-campanha';

describe('routeInteraction', () => {
  const pool = {} as Pool;
  const claudeClient = {} as Anthropic;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('despacha /criar-campanha para criarCampanha.execute', async () => {
    const spy = vi.spyOn(criarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient);
  });

  it('despacha /criar-personagem para criarPersonagem.execute', async () => {
    const spy = vi.spyOn(criarPersonagem, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-personagem' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal criar-personagem:* para criarPersonagem.handleModalSubmit', async () => {
    const spy = vi.spyOn(criarPersonagem, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'criar-personagem:abc123:Aria' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /iniciar-combate para iniciarCombate.execute', async () => {
    const spy = vi.spyOn(iniciarCombate, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'iniciar-combate' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal iniciar-combate:* para iniciarCombate.handleModalSubmit', async () => {
    const spy = vi.spyOn(iniciarCombate, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'iniciar-combate:abc123:Goblin' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /responder-campanha para responderCampanha.execute', async () => {
    const spy = vi.spyOn(responderCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'responder-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient);
  });

  it('ignora comandos desconhecidos sem lançar erro', async () => {
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'comando-desconhecido' } as any;
    await expect(routeInteraction(interaction, pool, claudeClient)).resolves.toBeUndefined();
  });
});
