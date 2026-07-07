import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config';
import { data as criarCampanhaData } from '../src/bot/commands/criar-campanha';
import { data as criarPersonagemData } from '../src/bot/commands/criar-personagem';
import { data as iniciarCombateData } from '../src/bot/commands/iniciar-combate';
import { data as responderCampanhaData } from '../src/bot/commands/responder-campanha';

async function main() {
  const config = loadConfig();
  const guildId = process.env.DISCORD_GUILD_ID;
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const route = guildId
    ? Routes.applicationGuildCommands(config.discordClientId, guildId)
    : Routes.applicationCommands(config.discordClientId);
  await rest.put(route, {
    body: [
      criarCampanhaData.toJSON(),
      criarPersonagemData.toJSON(),
      iniciarCombateData.toJSON(),
      responderCampanhaData.toJSON(),
    ],
  });
  console.log(
    guildId
      ? `Comandos registrados com sucesso no servidor ${guildId} (propagação instantânea).`
      : 'Comandos registrados globalmente com sucesso (pode levar até ~1h para propagar).'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
