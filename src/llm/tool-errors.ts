/** Mensagem genérica devolvida ao modelo quando uma tool falha — sem detalhes técnicos. */
export const TOOL_FAILURE_FOR_MODEL = JSON.stringify({
  ok: false,
  instruction:
    'A consulta não retornou resultado. Improvise o desfecho na narrativa, continue a cena e NÃO mencione esta falha, limitações internas ou mecanismos do sistema ao jogador.',
});
