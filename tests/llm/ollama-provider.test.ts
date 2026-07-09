import { describe, it, expect, vi } from 'vitest';
import type OpenAI from 'openai';
import { createOllamaProvider } from '../../src/llm/ollama-provider';
import { LLM_REQUEST_TIMEOUT_MS } from '../../src/config';
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

  it('passa um timeout de requisição para não travar indefinidamente', async () => {
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Ok.', tool_calls: undefined } }],
    });
    await provider.runTurn('system', 'oi', [], makeToolContext());
    const [, requestOptions] = create.mock.calls[0];
    expect(requestOptions).toEqual({ timeout: LLM_REQUEST_TIMEOUT_MS });
  });

  it('envia opções de CPU do Ollama (num_ctx, num_thread, max_tokens)', async () => {
    const provider = createOllamaProvider('http://localhost:11434', 'qwen2.5');
    const OpenAIModule = await import('openai');
    const clientInstance = (OpenAIModule.default as any).mock.results.at(-1).value as OpenAI;
    const create = clientInstance.chat.completions.create as any;
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Ok.', tool_calls: undefined } }],
    });
    await provider.runTurn('system', 'oi', [], makeToolContext());
    const [body] = create.mock.calls[0];
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.options.num_ctx).toBeGreaterThan(0);
    expect(body.options.num_thread).toBeGreaterThan(0);
    expect(body.keep_alive).toBe('-1');
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

  it('envia mensagem de tool com erro quando a ferramenta é desconhecida', async () => {
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
              { id: 'call-1', function: { name: 'ferramenta_inexistente', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Ok.', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'oi', [], makeToolContext());
    expect(result.narration).toBe('Ok.');
    const secondCallArgs = create.mock.calls[1][0];
    const toolMessage = secondCallArgs.messages.at(-1);
    expect(toolMessage.role).toBe('tool');
    const parsedContent = JSON.parse(toolMessage.content);
    expect(parsedContent.ok).toBe(false);
    expect(parsedContent.instruction).toMatch(/improvise/i);
    expect(toolMessage.content).not.toMatch(/ferramenta_inexistente/);
  });

  it('envia falha genérica (sem detalhe técnico) quando a ferramenta lança erro', async () => {
    const failingTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockRejectedValue(new Error('A ficha de "Aria" não tem o atributo "percepcao"')),
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
              { id: 'call-1', function: { name: 'fazer_teste', arguments: JSON.stringify({ attribute: 'percepcao', difficulty: 10 }) } },
            ],
          },
        },
      ],
    });
    create.mockResolvedValueOnce({
      choices: [{ message: { content: 'Você escuta passos ao longe.', tool_calls: undefined } }],
    });
    const result = await provider.runTurn('system', 'eu escuto', [failingTool], makeToolContext());
    expect(result.narration).toBe('Você escuta passos ao longe.');
    const toolMessage = create.mock.calls[1][0].messages.at(-1);
    const parsedContent = JSON.parse(toolMessage.content);
    expect(parsedContent.ok).toBe(false);
    expect(toolMessage.content).not.toMatch(/percepcao|Aria|não tem o atributo/i);
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
