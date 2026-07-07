const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export interface SplitMessage {
  first: string;
  rest: string[];
}

export function splitDiscordMessage(text: string, maxLength = DISCORD_MAX_MESSAGE_LENGTH): SplitMessage {
  if (text.length <= maxLength) return { first: text, rest: [] };

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);

  const [first, ...rest] = chunks;
  return { first: first ?? '', rest };
}
