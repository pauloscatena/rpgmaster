import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeProvider } from '../../src/llm/claude-provider';
import type { ToolContext, ToolDefinition } from '../../src/llm/tools';
import { createCharacterSheet, defaultRulesetConfig } from '../../src/rules-engine';
import type { StoredCharacter } from '../../src/db/characters-repo';

function makeToolContext(): ToolContext {
  const config = defaultRulesetConfig();
  const sheet = createCharacterSheet(config, 'Aria', { forca: 3, destreza: 2, intelecto: 1 });
  const actingCharacter: StoredCharacter = { id: 'char-1', campaignId: 'camp-1', playerDiscordId: 'player-1', sheet };
  return { config, actingCharacter, rng: () => 0.5 };
}

function makeFakeClient(responses: unknown[]): Anthropic {
  const create = vi.fn();
  responses.forEach((r) => create.mockResolvedValueOnce(r));
  return { messages: { create } } as unknown as Anthropic;
}

describe('createClaudeProvider().runTurn', () => {
  it('devolve a narração direto quando não há chamada de ferramenta', async () => {
    const client = makeFakeClient([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Você entra na sala escura.' }] },
    ]);
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'eu entro na sala', [], makeToolContext());
    expect(result.narration).toBe('Você entra na sala escura.');
    expect(result.toolCalls).toEqual([]);
  });

  it('executa a ferramenta chamada e usa o resultado na resposta seguinte', async () => {
    const testTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({ total: 14, success: true }),
    };
    const client = makeFakeClient([
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 } }],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Você consegue escalar o muro!' }] },
    ]);
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'eu escalo o muro', [testTool], makeToolContext());
    expect(testTool.execute).toHaveBeenCalledWith({ attribute: 'forca', difficulty: 10 }, expect.anything());
    expect(result.narration).toBe('Você consegue escalar o muro!');
    expect(result.toolCalls).toEqual([
      { name: 'fazer_teste', input: { attribute: 'forca', difficulty: 10 }, result: { total: 14, success: true } },
    ]);
  });

  it('envia tool_result com is_error quando a ferramenta é desconhecida', async () => {
    const client = makeFakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-1', name: 'ferramenta_inexistente', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] },
    ]);
    const provider = createClaudeProvider(client);
    const result = await provider.runTurn('system', 'oi', [], makeToolContext());
    expect(result.narration).toBe('Ok.');
    const secondCallArgs = (client.messages.create as any).mock.calls[1][0];
    const toolResultMessage = secondCallArgs.messages.at(-1);
    expect(toolResultMessage.content[0].is_error).toBe(true);
  });

  it('lança erro ao exceder o número máximo de iterações', async () => {
    const infiniteTool: ToolDefinition = {
      name: 'fazer_teste',
      description: 'teste',
      inputSchema: { type: 'object', properties: {} },
      execute: vi.fn().mockResolvedValue({}),
    };
    const alwaysToolUse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'fazer_teste', input: {} }],
    };
    const client = makeFakeClient(Array(10).fill(alwaysToolUse));
    const provider = createClaudeProvider(client);
    await expect(provider.runTurn('system', 'oi', [infiniteTool], makeToolContext())).rejects.toThrow(/máximo/);
  });
});
