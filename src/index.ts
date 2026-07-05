import 'dotenv/config';
import { createPool } from './db/pool';
import { createDiscordClient } from './bot/client';
import { routeInteraction } from './bot/interaction-router';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = createDiscordClient();

  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool).catch((err) => {
      console.error('Erro ao processar interação:', err);
    });
  });

  client.once('ready', () => {
    console.log(`Bot conectado como ${client.user?.tag}`);
  });

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
