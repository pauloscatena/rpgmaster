import type Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config';
import { createClaudeProvider } from './claude-provider';
import { createOllamaProvider } from './ollama-provider';
import type { LlmProvider } from './provider';

export function createLlmProvider(config: Config, claudeClient: Anthropic): LlmProvider {
  if (config.llmProvider === 'claude') {
    return createClaudeProvider(claudeClient);
  }
  return createOllamaProvider(config.ollamaBaseUrl, config.ollamaModel);
}
