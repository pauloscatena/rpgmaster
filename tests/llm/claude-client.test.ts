import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createClaudeClient } from '../../src/llm/claude-client';

describe('createClaudeClient', () => {
  it('cria uma instância do cliente Anthropic', () => {
    const client = createClaudeClient('fake-api-key');
    expect(client).toBeInstanceOf(Anthropic);
  });
});
