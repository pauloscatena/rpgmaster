import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAttachmentText } from '../../src/bot/attachments';

describe('fetchAttachmentText', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('baixa e devolve o texto do anexo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'conteúdo do documento' }));
    const text = await fetchAttachmentText('https://discord.example/doc.txt');
    expect(text).toBe('conteúdo do documento');
  });

  it('lança erro quando a resposta não é ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' }));
    await expect(fetchAttachmentText('https://discord.example/doc.txt')).rejects.toThrow(/404/);
  });
});
