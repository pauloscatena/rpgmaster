import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL, LLM_REQUEST_TIMEOUT_MS } from '../config';
import type { GameMasterTurnResult, LlmProvider } from './provider';
import { TOOL_FAILURE_FOR_MODEL } from './tool-errors';
import type { ToolContext, ToolDefinition } from './tools';

const MAX_TOOL_ITERATIONS = 6;

export function createClaudeProvider(client: Anthropic, model = CLAUDE_MODEL): LlmProvider {
  return {
    async runTurn(
      systemPrompt: string,
      userMessage: string,
      tools: ToolDefinition[],
      toolContext: ToolContext
    ): Promise<GameMasterTurnResult> {
      const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));

      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }];
      const toolCalls: GameMasterTurnResult['toolCalls'] = [];

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 1024,
            system: systemPrompt,
            messages,
            tools: anthropicTools,
          },
          { timeout: LLM_REQUEST_TIMEOUT_MS }
        );

        if (response.stop_reason !== 'tool_use') {
          const narration = response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            .join('\n');
          return { narration, toolCalls };
        }

        messages.push({ role: 'assistant', content: response.content });

        const toolResultContent: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const tool = tools.find((t) => t.name === block.name);
          if (!tool) {
            console.error('Ferramenta desconhecida no Claude:', block.name);
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: TOOL_FAILURE_FOR_MODEL,
              is_error: true,
            });
            continue;
          }
          try {
            const result = await tool.execute(block.input, toolContext);
            toolCalls.push({ name: block.name, input: block.input, result });
            toolResultContent.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err) {
            console.error('Erro ao executar ferramenta no Claude:', block.name, err);
            toolResultContent.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: TOOL_FAILURE_FOR_MODEL,
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: toolResultContent });
      }

      throw new Error('Número máximo de chamadas de ferramenta excedido nesta rodada.');
    },
  };
}
