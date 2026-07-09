import OpenAI from 'openai';
import { LLM_REQUEST_TIMEOUT_MS, OLLAMA_NUM_PREDICT } from '../config';
import type { GameMasterTurnResult, LlmProvider } from './provider';
import { TOOL_FAILURE_FOR_MODEL } from './tool-errors';
import type { ToolContext, ToolDefinition } from './tools';

const MAX_TOOL_ITERATIONS = 6;

/** Opções nativas do Ollama (API OpenAI-compat as encaminha no body). */
function ollamaRequestExtras(): Record<string, unknown> {
  const numCtx = Number(process.env.OLLAMA_NUM_CTX) || 4096;
  const numThread = Number(process.env.OLLAMA_NUM_THREAD) || 4;
  return {
    max_tokens: OLLAMA_NUM_PREDICT,
    // keep_alive no body reforça o do servidor (modelo sempre em RAM)
    keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '-1',
    options: {
      num_ctx: numCtx,
      num_thread: numThread,
      num_predict: OLLAMA_NUM_PREDICT,
    },
  };
}

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
          { model, messages, tools: openAiTools, ...ollamaRequestExtras() } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
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
            console.error('Ferramenta desconhecida no Ollama:', call.function.name);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: TOOL_FAILURE_FOR_MODEL,
            });
            continue;
          }
          try {
            const input = JSON.parse(call.function.arguments);
            const result = await tool.execute(input, toolContext);
            toolCalls.push({ name: call.function.name, input, result });
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          } catch (err) {
            console.error('Erro ao executar ferramenta no Ollama:', call.function.name, err);
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: TOOL_FAILURE_FOR_MODEL,
            });
          }
        }
      }

      throw new Error('Número máximo de chamadas de ferramenta excedido nesta rodada.');
    },
  };
}
