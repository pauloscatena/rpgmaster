const TOOL_TAG_BLOCK =
  /<(tools|tool_calls|tool_call|tool_response|function_call|function_calls)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const TOOL_TAG_LOOSE = /<\/?(?:tools|tool_calls|tool_call|tool_response|function_call|function_calls)\b[^>]*\/?>/gi;

/** Remove artefatos de tool/XML que modelos pequenos às vezes colam no texto da narração. */
export function sanitizeMasterReply(text: string): string {
  let out = text;

  // Fences com tool tags / JSON de tool — remove o bloco inteiro antes de limpar tags soltas
  out = out.replace(/```(?:xml|tool|tools)?\s*\n?([\s\S]*?)```/gi, (full, inner: string) => {
    if (/<\/?(?:tools|tool_calls|tool_call|tool_response|function_call|function_calls)\b/i.test(full)) {
      return '';
    }
    if (/^\s*\{[\s\S]*"name"\s*:[\s\S]*\}\s*$/.test(inner) && /tool|function/i.test(inner)) {
      return '';
    }
    return full;
  });

  out = out.replace(TOOL_TAG_BLOCK, '');
  out = out.replace(TOOL_TAG_LOOSE, '');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}
