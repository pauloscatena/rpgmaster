import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  const claudeEnv = {
    DISCORD_TOKEN: 'token-a',
    DISCORD_CLIENT_ID: 'client-b',
    DATABASE_URL: 'postgres://c',
    ANTHROPIC_API_KEY: 'sk-ant-d',
  };

  it('usa claude por padrão quando LLM_PROVIDER não é definido', () => {
    const config = loadConfig(claudeEnv);
    expect(config).toEqual({
      discordToken: 'token-a',
      discordClientId: 'client-b',
      databaseUrl: 'postgres://c',
      anthropicApiKey: 'sk-ant-d',
      llmProvider: 'claude',
    });
  });

  it('lança erro quando falta DISCORD_TOKEN', () => {
    const { DISCORD_TOKEN, ...rest } = claudeEnv;
    expect(() => loadConfig(rest)).toThrow(/DISCORD_TOKEN/);
  });

  it('lança erro quando falta DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = claudeEnv;
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it('lança erro quando falta ANTHROPIC_API_KEY mesmo com LLM_PROVIDER=ollama', () => {
    const { ANTHROPIC_API_KEY, ...rest } = claudeEnv;
    expect(() =>
      loadConfig({ ...rest, LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_MODEL: 'qwen2.5' })
    ).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('lança erro quando LLM_PROVIDER é um valor desconhecido', () => {
    expect(() => loadConfig({ ...claudeEnv, LLM_PROVIDER: 'gpt-mágico' })).toThrow(/LLM_PROVIDER inválido/);
  });

  it('carrega config de ollama quando LLM_PROVIDER=ollama e as variáveis de ollama estão presentes', () => {
    const config = loadConfig({
      ...claudeEnv,
      LLM_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'qwen2.5',
    });
    expect(config).toEqual({
      discordToken: 'token-a',
      discordClientId: 'client-b',
      databaseUrl: 'postgres://c',
      anthropicApiKey: 'sk-ant-d',
      llmProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5',
    });
  });

  it('lança erro quando LLM_PROVIDER=ollama mas falta OLLAMA_BASE_URL', () => {
    expect(() =>
      loadConfig({ ...claudeEnv, LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2.5' })
    ).toThrow(/OLLAMA_BASE_URL/);
  });

  it('lança erro quando LLM_PROVIDER=ollama mas falta OLLAMA_MODEL', () => {
    expect(() =>
      loadConfig({ ...claudeEnv, LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://localhost:11434' })
    ).toThrow(/OLLAMA_MODEL/);
  });

  it('decodifica GOOGLE_SERVICE_ACCOUNT_KEY de base64 quando presente', () => {
    const jsonKey = JSON.stringify({ client_email: 'bot@example.iam.gserviceaccount.com', private_key: 'fake-key' });
    const encoded = Buffer.from(jsonKey, 'utf-8').toString('base64');
    const config = loadConfig({ ...claudeEnv, GOOGLE_SERVICE_ACCOUNT_KEY: encoded });
    expect(config.googleServiceAccountKey).toBe(jsonKey);
  });

  it('deixa googleServiceAccountKey indefinido quando GOOGLE_SERVICE_ACCOUNT_KEY não está definido', () => {
    const config = loadConfig(claudeEnv);
    expect(config.googleServiceAccountKey).toBeUndefined();
  });
});
