/** Primeiro token do nome completo; se vazio, devolve o nome trimado. */
export function defaultShortName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return trimmed;
  const first = trimmed.split(/\s+/)[0];
  return first && first.length > 0 ? first : trimmed;
}
