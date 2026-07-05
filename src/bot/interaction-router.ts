import type { Interaction } from 'discord.js';
import type { Pool } from 'pg';
import * as criarCampanha from './commands/criar-campanha';
import * as criarPersonagem from './commands/criar-personagem';

export async function routeInteraction(interaction: Interaction, pool: Pool): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'criar-campanha') {
      await criarCampanha.execute(interaction, pool);
      return;
    }
    if (interaction.commandName === 'criar-personagem') {
      await criarPersonagem.execute(interaction, pool);
      return;
    }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('criar-personagem:')) {
      await criarPersonagem.handleModalSubmit(interaction, pool);
      return;
    }
  }
}
