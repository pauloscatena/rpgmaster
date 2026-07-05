export function appendToSessionSummary(current: string, exchange: string, maxLength = 4000): string {
  const combined = current ? `${current}\n${exchange}` : exchange;
  if (combined.length <= maxLength) return combined;
  return combined.slice(combined.length - maxLength);
}
