import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config';
import { data as criarCampanhaData } from '../src/bot/commands/criar-campanha';
import { data as criarPersonagemData } from '../src/bot/commands/criar-personagem';

async function main() {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  await rest.put(Routes.applicationCommands(config.discordClientId), {
    body: [criarCampanhaData.toJSON(), criarPersonagemData.toJSON()],
  });
  console.log('Comandos registrados com sucesso.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
