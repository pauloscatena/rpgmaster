import type { ToolContext, ToolDefinition } from './tools';

export interface GameMasterTurnResult {
  narration: string;
  toolCalls: { name: string; input: unknown; result: unknown }[];
}

export interface LlmProvider {
  runTurn(
    systemPrompt: string,
    userMessage: string,
    tools: ToolDefinition[],
    toolContext: ToolContext
  ): Promise<GameMasterTurnResult>;
}
