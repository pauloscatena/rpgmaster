import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('carrega uma config válida a partir do ambiente', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'token-a', DISCORD_CLIENT_ID: 'client-b', DATABASE_URL: 'postgres://c' });
    expect(config).toEqual({ discordToken: 'token-a', discordClientId: 'client-b', databaseUrl: 'postgres://c' });
  });

  it('lança erro quando falta DISCORD_TOKEN', () => {
    expect(() => loadConfig({ DISCORD_CLIENT_ID: 'b', DATABASE_URL: 'c' })).toThrow(/DISCORD_TOKEN/);
  });

  it('lança erro quando falta DATABASE_URL', () => {
    expect(() => loadConfig({ DISCORD_TOKEN: 'a', DISCORD_CLIENT_ID: 'b' })).toThrow(/DATABASE_URL/);
  });
});
