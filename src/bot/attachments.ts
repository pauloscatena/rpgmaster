import pdfParse from 'pdf-parse';

export async function fetchAttachmentText(url: string, filename: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar o documento da campanha (status ${response.status}).`);
  }

  const isPdf = filename.toLowerCase().endsWith('.pdf');
  const text = isPdf
    ? (await pdfParse(Buffer.from(await response.arrayBuffer()))).text
    : await response.text();

  // Postgres rejeita o byte 0x00 em colunas de texto; documentos binários mal interpretados podem trazê-lo.
  return text.replace(/\0/g, '');
}
