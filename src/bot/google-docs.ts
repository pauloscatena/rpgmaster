export class InvalidGoogleDocsLinkError extends Error {
  constructor(link: string) {
    super(`Link inválido: "${link}" não parece ser um link válido do Google Docs.`);
    this.name = 'InvalidGoogleDocsLinkError';
  }
}

export class GoogleDocsPermissionError extends Error {
  constructor(serviceAccountEmail: string) {
    super(
      `Não tenho permissão para ler esse Google Docs. Compartilhe o documento com "${serviceAccountEmail}" como leitor e tente novamente.`
    );
    this.name = 'GoogleDocsPermissionError';
  }
}

export class GoogleDocsNotFoundError extends Error {
  constructor() {
    super('Documento não encontrado. Confira se o link do Google Docs está correto.');
    this.name = 'GoogleDocsNotFoundError';
  }
}

export function extractGoogleDocId(link: string): string {
  const match = link.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  const id = match?.[1];
  if (!id) {
    throw new InvalidGoogleDocsLinkError(link);
  }
  return id;
}
