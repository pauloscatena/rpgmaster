import pdfParse from 'pdf-parse';

const SUPPORTED_EXTENSIONS = ['.txt', '.pdf'] as const;

export class UnsupportedAttachmentError extends Error {
  constructor(filename: string) {
    super(`Formato de arquivo não suportado: "${filename}". Envie um documento em .txt ou .pdf.`);
    this.name = 'UnsupportedAttachmentError';
  }
}

export async function fetchAttachmentText(url: string, filename: string): Promise<string> {
  const lowerName = filename.toLowerCase();
  const extension = SUPPORTED_EXTENSIONS.find((ext) => lowerName.endsWith(ext));
  if (!extension) {
    throw new UnsupportedAttachmentError(filename);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar o documento da campanha (status ${response.status}).`);
  }

  const text =
    extension === '.pdf'
      ? (await pdfParse(Buffer.from(await response.arrayBuffer()))).text
      : await response.text();

  // Postgres rejeita o byte 0x00 em colunas de texto; documentos binários mal interpretados podem trazê-lo.
  return text.replace(/\0/g, '');
}
