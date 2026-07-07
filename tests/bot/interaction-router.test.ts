import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import { routeInteraction } from '../../src/bot/interaction-router';
import * as criarCampanha from '../../src/bot/commands/criar-campanha';
import * as criarPersonagem from '../../src/bot/commands/criar-personagem';
import * as iniciarCombate from '../../src/bot/commands/iniciar-combate';
import * as responderCampanha from '../../src/bot/commands/responder-campanha';
import * as iniciarCampanha from '../../src/bot/commands/iniciar-campanha';
import * as pausarCampanha from '../../src/bot/commands/pausar-campanha';
import * as retomarCampanha from '../../src/bot/commands/retomar-campanha';
import * as minhaFicha from '../../src/bot/commands/minha-ficha';

describe('routeInteraction', () => {
  const pool = {} as Pool;
  const claudeClient = {} as Anthropic;
  const googleServiceAccountKey = 'chave-de-servico-fake';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('despacha /criar-campanha para criarCampanha.execute', async () => {
    const spy = vi.spyOn(criarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient, googleServiceAccountKey);
  });

  it('despacha /criar-personagem para criarPersonagem.execute', async () => {
    const spy = vi.spyOn(criarPersonagem, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'criar-personagem' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal criar-personagem:* para criarPersonagem.handleModalSubmit', async () => {
    const spy = vi.spyOn(criarPersonagem, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'criar-personagem:abc123:Aria' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /iniciar-combate para iniciarCombate.execute', async () => {
    const spy = vi.spyOn(iniciarCombate, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'iniciar-combate' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha modal iniciar-combate:* para iniciarCombate.handleModalSubmit', async () => {
    const spy = vi.spyOn(iniciarCombate, 'handleModalSubmit').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => false, isModalSubmit: () => true, customId: 'iniciar-combate:abc123:Goblin' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /responder-campanha para responderCampanha.execute', async () => {
    const spy = vi.spyOn(responderCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'responder-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool, claudeClient);
  });

  it('despacha /iniciar-campanha para iniciarCampanha.execute', async () => {
    const spy = vi.spyOn(iniciarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'iniciar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /pausar-campanha para pausarCampanha.execute', async () => {
    const spy = vi.spyOn(pausarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'pausar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /retomar-campanha para retomarCampanha.execute', async () => {
    const spy = vi.spyOn(retomarCampanha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'retomar-campanha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('despacha /minha-ficha para minhaFicha.execute', async () => {
    const spy = vi.spyOn(minhaFicha, 'execute').mockResolvedValue(undefined);
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'minha-ficha' } as any;
    await routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey);
    expect(spy).toHaveBeenCalledWith(interaction, pool);
  });

  it('ignora comandos desconhecidos sem lançar erro', async () => {
    const interaction = { isChatInputCommand: () => true, isModalSubmit: () => false, commandName: 'comando-desconhecido' } as any;
    await expect(routeInteraction(interaction, pool, claudeClient, googleServiceAccountKey)).resolves.toBeUndefined();
  });
});
