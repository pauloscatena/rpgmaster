export const CLAUDE_MODEL = 'claude-sonnet-5';

interface BaseConfig {
  discordToken: string;
  discordClientId: string;
  databaseUrl: string;
  anthropicApiKey: string;
}

export type Config =
  | (BaseConfig & { llmProvider: 'claude' })
  | (BaseConfig & { llmProvider: 'ollama'; ollamaBaseUrl: string; ollamaModel: string });

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const discordToken = env.DISCORD_TOKEN;
  const discordClientId = env.DISCORD_CLIENT_ID;
  const databaseUrl = env.DATABASE_URL;
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!discordToken) throw new Error('DISCORD_TOKEN não definido');
  if (!discordClientId) throw new Error('DISCORD_CLIENT_ID não definido');
  if (!databaseUrl) throw new Error('DATABASE_URL não definido');
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY não definido (necessário mesmo com LLM_PROVIDER=ollama, usado na ingestão de documentos)');
  }

  const llmProviderRaw = env.LLM_PROVIDER ?? 'claude';
  if (llmProviderRaw !== 'claude' && llmProviderRaw !== 'ollama') {
    throw new Error(`LLM_PROVIDER inválido: "${llmProviderRaw}" (use "claude" ou "ollama")`);
  }

  if (llmProviderRaw === 'ollama') {
    const ollamaBaseUrl = env.OLLAMA_BASE_URL;
    const ollamaModel = env.OLLAMA_MODEL;
    if (!ollamaBaseUrl) throw new Error('OLLAMA_BASE_URL não definido (necessário quando LLM_PROVIDER=ollama)');
    if (!ollamaModel) throw new Error('OLLAMA_MODEL não definido (necessário quando LLM_PROVIDER=ollama)');
    return { discordToken, discordClientId, databaseUrl, anthropicApiKey, llmProvider: 'ollama', ollamaBaseUrl, ollamaModel };
  }

  return { discordToken, discordClientId, databaseUrl, anthropicApiKey, llmProvider: 'claude' };
}
