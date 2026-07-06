export async function fetchAttachmentText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar o documento da campanha (status ${response.status}).`);
  }
  return response.text();
}
