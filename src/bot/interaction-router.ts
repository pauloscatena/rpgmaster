import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from '../llm/provider';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';
import * as iniciarCombate from './commands/iniciar-combate';
import * as responderCampanha from './commands/responder-campanha';
import * as iniciarCampanha from './commands/iniciar-campanha';
import * as pausarCampanha from './commands/pausar-campanha';
import * as retomarCampanha from './commands/retomar-campanha';
import * as minhaFicha from './commands/minha-ficha';
import * as inventario from './commands/inventario';
import * as carteira from './commands/carteira';
import * as poderes from './commands/poderes';
import * as conceder from './commands/conceder';
import * as percepcao from './commands/percepcao';

export async function routeInteraction(
  interaction: Interaction,
  pool: Pool,
  claudeClient: Anthropic,
  llmProvider: LlmProvider
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    if (name === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool, claudeClient);
      return;
    }
    if (name === 'criar-personagem') {
      await criarPersonagem.execute(interaction, pool);
      return;
    }
    if (name === 'iniciar-combate') {
      await iniciarCombate.execute(interaction, pool);
      return;
    }
    if (name === 'responder-campanha') {
      await responderCampanha.execute(interaction, pool, claudeClient);
      return;
    }
    if (name === 'iniciar-campanha') {
      await iniciarCampanha.execute(interaction, pool);
      return;
    }
    if (name === 'pausar-campanha') {
      await pausarCampanha.execute(interaction, pool);
      return;
    }
    if (name === 'retomar-campanha') {
      await retomarCampanha.execute(interaction, pool);
      return;
    }
    if (name === 'minha-ficha') {
      await minhaFicha.execute(interaction, pool);
      return;
    }
    if (name === 'inventario') {
      await inventario.executeInventario(interaction, pool);
      return;
    }
    if (name === 'usar') {
      await inventario.executeUsar(interaction, pool);
      return;
    }
    if (name === 'ler') {
      await inventario.executeLer(interaction, pool);
      return;
    }
    if (name === 'dar') {
      await inventario.executeDar(interaction, pool);
      return;
    }
    if (name === 'jogar-fora') {
      await inventario.executeJogarFora(interaction, pool);
      return;
    }
    if (name === 'carteira') {
      await carteira.executeCarteira(interaction, pool);
      return;
    }
    if (name === 'pagar') {
      await carteira.executePagar(interaction, pool);
      return;
    }
    if (name === 'dar-dinheiro') {
      await carteira.executeDarDinheiro(interaction, pool);
      return;
    }
    if (name === 'poderes') {
      await poderes.executePoderes(interaction, pool);
      return;
    }
    if (name === 'definir-classe') {
      await poderes.executeDefinirClasse(interaction, pool);
      return;
    }
    if (name === 'aprender-poder') {
      await poderes.executeAprenderPoder(interaction, pool);
      return;
    }
    if (name === 'evoluir-poder') {
      await poderes.executeEvoluirPoder(interaction, pool);
      return;
    }
    if (name === 'evoluir-atributo') {
      await poderes.executeEvoluirAtributo(interaction, pool);
      return;
    }
    if (name === 'conceder-item') {
      await conceder.executeConcederItem(interaction, pool);
      return;
    }
    if (name === 'conceder-xp') {
      await conceder.executeConcederXp(interaction, pool);
      return;
    }
    if (name === 'conceder-dinheiro') {
      await conceder.executeConcederDinheiro(interaction, pool);
      return;
    }
    if (name === 'definir-capacidade-bolsa') {
      await conceder.executeDefinirCapacidadeBolsa(interaction, pool);
      return;
    }
    if (name === 'percepcao') {
      await percepcao.execute(interaction, pool, llmProvider);
      return;
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('criar-personagem:')) {
      await criarPersonagem.handleModalSubmit(interaction, pool);
      return;
    }
    if (interaction.customId.startsWith('iniciar-combate:')) {
      await iniciarCombate.handleModalSubmit(interaction, pool);
      return;
    }
  }
}
