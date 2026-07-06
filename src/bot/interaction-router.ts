import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import type Anthropic from '@anthropic-ai/sdk';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';
import * as iniciarCombate from './commands/iniciar-combate';
import * as responderCampanha from './commands/responder-campanha';

export async function routeInteraction(interaction: Interaction, pool: Pool, claudeClient: Anthropic): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool, claudeClient);
      return;
    }
    if (interaction.commandName === 'criar-personagem') {
      await criarPersonagem.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'iniciar-combate') {
      await iniciarCombate.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'responder-campanha') {
      await responderCampanha.execute(interaction, pool, claudeClient);
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
