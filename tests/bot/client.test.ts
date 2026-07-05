import { describe, it, expect } from 'vitest';
import { Client } from 'discord.js';
import { createDiscordClient } from '../../src/bot/client';

describe('createDiscordClient', () => {
  it('cria uma instância de Client do discord.js', () => {
    const client = createDiscordClient();
    expect(client).toBeInstanceOf(Client);
  });
});
