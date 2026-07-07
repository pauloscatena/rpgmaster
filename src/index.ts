import 'dotenv/config';
import { createPool } from './db/pool';
import { createDiscordClient } from './bot/client';
import { routeInteraction } from './bot/interaction-router';
import { handleMessage } from './bot/message-handler';
import { createClaudeClient } from './llm/claude-client';
import { createLlmProvider } from './llm/create-provider';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const client = createDiscordClient();
  const claudeClient = createClaudeClient(config.anthropicApiKey); // usado na ingestão de documentos (Plano 5), sempre Claude
  const llmProvider = createLlmProvider(config, claudeClient); // laço narrativo/combate, agnóstico de provedor

  client.on('interactionCreate', (interaction) => {
    routeInteraction(interaction, pool, claudeClient, config.googleServiceAccountKey).catch((err) => {
      console.error('Erro ao processar interação:', err);
    });
  });

  client.on('messageCreate', (message) => {
    handleMessage(message, pool, llmProvider, claudeClient).catch((err) => {
      console.error('Erro ao processar mensagem:', err);
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
