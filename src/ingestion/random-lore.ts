import type Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from '../config';

const GENRE_SEEDS = [
  'em tom de alta fantasia clássica, com reinos, magia e profecias',
  'em tom de horror cósmico à la Lovecraft, com mistérios inquietantes e uma sensação de pequenez diante do desconhecido',
  'em tom cyberpunk distópico, com megacorporações, tecnologia decadente e neon',
  'em tom de faroeste sombrio, com fronteiras sem lei e moral em tons de cinza',
  'em tom de aventura de piratas em mares desconhecidos, com tesouros e traição',
] as const;

function pickGenreSeed(rng: () => number): string {
  const index = Math.floor(rng() * GENRE_SEEDS.length);
  return GENRE_SEEDS[index] ?? GENRE_SEEDS[0];
}

function buildRandomLorePrompt(genreSeed: string): string {
  return `Invente um gancho de aventura curto e divertido para uma campanha de RPG de mesa, ${genreSeed}, em português, entre 2 e 4 frases. Seja criativo e variado — evite sempre começar da mesma forma. Responda só com o texto do gancho, sem título nem comentários extras.`;
}

export async function generateRandomLore(client: Anthropic, rng: () => number = Math.random): Promise<string> {
  const prompt = buildRandomLorePrompt(pickGenreSeed(rng));
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) {
    throw new Error('O modelo não devolveu uma lore em texto.');
  }
  return block.text.trim();
}
