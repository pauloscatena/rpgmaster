import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../config';

const RANDOM_LORE_PROMPT =
  'Invente um gancho de aventura curto e divertido para uma campanha de RPG de mesa genérica, em português, entre 2 e 4 frases. Seja criativo e variado — evite sempre começar da mesma forma. Responda só com o texto do gancho, sem título nem comentários extras.';

export async function generateRandomLore(client: Anthropic): Promise<string> {
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: RANDOM_LORE_PROMPT }],
  });
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) {
    throw new Error('O modelo não devolveu uma lore em texto.');
  }
  return block.text.trim();
}
