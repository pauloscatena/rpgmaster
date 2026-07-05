import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createOllamaProvider } from '../../src/llm/ollama-provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: vi.fn() } },
    })),
  };
});

function makeToolContext(): ToolContext {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  return { config, actingCharacter, rng: () => 0.5 };
}

describe('createOllamaProvider().runTurn', () => {
  it('devolve a narração direto quando não há tool_calls', async () => {
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results[0].value as OpenAI;
    (clientInstance.chat.completions.create as any).mockResolvedValueOnce({
      choices: [{ message: { content: 'Você entra na sala escura.', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'eu entro na sala', [], makeToolContext());
    expect(result.narration).toBe('Você entra na sala escura.');
    expect(result.toolCalls).toEqual([]);
  });

  it('executa a ferramenta chamada via tool_calls e usa o resultado na resposta seguinte', async () => {
    const testTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ total: 14, success: true }),
    };
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call-1', function: { name: 'fazer_teste', arguments: JSON.stringify({ attribute: 'forca', difficulty: 10 }) } },
            ],
          },
        },
      ],
    });
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Você consegue escalar o muro!', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'eu escalo o muro', [testTool], makeToolContext());
    expect(testTool.execute).toHaveBeenCalledWith({ attribute: 'forca', difficulty: 10 }, expect.anything());
    expect(result.narration).toBe('Você consegue escalar o muro!');
    expect(result.toolCalls).toEqual([
      { name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 }, result: { total: 14, success: true } },
    ]);
  });

  it('lança erro ao exceder o número máximo de iterações', async () => {
    const infiniteTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({}),
    };
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    const alwaysToolCall = {
      choices: [
        { message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'fazer_teste', arguments: '{}' } }] } },
      ],
    };
    for (let i = 0; i < 10; i++) create.mockResolvedValueOnce(alwaysToolCall);
    await expect(provider.runTurn('system', 'oi', [infiniteTool], makeToolContext())).rejects.toThrow(/máximo/);
  });
});
