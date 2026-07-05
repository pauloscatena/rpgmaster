import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createLlmProvider } from '../../src/llm/create-provider';
import type { Config } from '../../src/config';

describe('createLlmProvider', () => {
  const claudeClient = {} as Anthropic;

  it('devolve um provider com runTurn quando llmProvider é claude', () => {
    const config: Config = {
      discordToken: 'a',
      discordClientId: 'b',
      databaseUrl: 'c',
      anthropicApiKey: 'd',
      llmProvider: 'claude',
    };
    const provider = createLlmProvider(config, claudeClient);
    expect(typeof provider.runTurn).toBe('function');
  });

  it('devolve um provider com runTurn quando llmProvider é ollama', () => {
    const config: Config = {
      discordToken: 'a',
      discordClientId: 'b',
      databaseUrl: 'c',
      anthropicApiKey: 'd',
      llmProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'qwen2.5',
    };
    const provider = createLlmProvider(config, claudeClient);
    expect(typeof provider.runTurn).toBe('function');
  });
});
