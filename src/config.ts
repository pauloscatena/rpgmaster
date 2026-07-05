export interface Config {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordToken = env.DISCORD_TOKEN;
  const discordClientId = env.DISCORD_CLIENT_ID;
  const databaseUrl = env.DATABASE_URL;
  if (!discordToken) throw new Error('DISCORD_TOKEN não definido');
  if (!discordClientId) throw new Error('DISCORD_CLIENT_ID não definido');
  if (!databaseUrl) throw new Error('DATABASE_URL não definido');
  return { discordToken, discordClientId, databaseUrl };
}
