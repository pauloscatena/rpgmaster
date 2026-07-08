import OpenAI from 'openai';
import { LLM_REQUEST_TIMEOUT_MS } from '../config';
import type { GameMasterTurnResult, LlmProvider } from './provider';
import type { ToolContext, ToolDefinition } from './tools';

const MAX_TOOL_ITERATIONS = 6;

export function createOllamaProvider(baseUrl: string, model: string): LlmProvider {
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: 'ollama' });

  return {
    async runTurn(
      systemPrompt: string,
      userMessage: string,
      tools: ToolDefinition[],
      toolContext: ToolContext
    ): Promise<GameMasterTurnResult> {
      const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];
      const toolCalls: GameMasterTurnResult['toolCalls'] = [];

      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        const response = await client.chat.completions.create(
          { model, messages, tools: openAiTools },
          { timeout: LLM_REQUEST_TIMEOUT_MS }
        );
        const choice = response.choices[0];
        if (!choice) {
          throw new Error('Resposta do Ollama não contém nenhuma escolha (choices).');
        }
        const message = choice.message;

        if (!message.tool_calls || message.tool_calls.length === 0) {
          return { narration: message.content ?? '', toolCalls };
        }

        messages.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls });

        for (const call of message.tool_calls) {
          const tool = tools.find((t) => t.name === call.function.name);
          if (!tool) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: `Ferramenta desconhecida: ${call.function.name}` }),
            });
            continue;
          }
          try {
            const input = JSON.parse(call.function.arguments);
            const result = await tool.execute(input, toolContext);
            toolCalls.push({ name: call.function.name, input, result });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          } catch (err) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: (err as Error).message }),
            });
          }
        }
      }

      throw new Error('Número máximo de chamadas de ferramenta excedido nesta rodada.');
    },
  };
}
