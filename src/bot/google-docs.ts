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

interface GoogleDocsTextRun {
  content: string;
}

interface GoogleDocsParagraphElement {
  textRun?: GoogleDocsTextRun;
}

interface GoogleDocsParagraph {
  elements: GoogleDocsParagraphElement[];
}

interface GoogleDocsTableCell {
  content: GoogleDocsStructuralElement[];
}

interface GoogleDocsTableRow {
  tableCells: GoogleDocsTableCell[];
}

interface GoogleDocsTable {
  tableRows: GoogleDocsTableRow[];
}

interface GoogleDocsStructuralElement {
  paragraph?: GoogleDocsParagraph;
  table?: GoogleDocsTable;
}

export interface GoogleDocsTab {
  tabProperties: { title: string };
  documentTab?: { body: { content: GoogleDocsStructuralElement[] } };
  childTabs?: GoogleDocsTab[];
}

export interface GoogleDocsDocument {
  tabs?: GoogleDocsTab[];
}

function extractStructuralElementsText(elements: GoogleDocsStructuralElement[]): string {
  const parts: string[] = [];
  for (const element of elements) {
    if (element.paragraph) {
      const paragraphText = element.paragraph.elements.map((e) => e.textRun?.content ?? '').join('');
      parts.push(paragraphText);
    }
    if (element.table) {
      for (const row of element.table.tableRows) {
        for (const cell of row.tableCells) {
          parts.push(extractStructuralElementsText(cell.content));
        }
      }
    }
  }
  return parts.join('');
}

export function extractTextFromTabs(tabs: GoogleDocsTab[]): string {
  const sections: string[] = [];
  for (const tab of tabs) {
    const bodyContent = tab.documentTab?.body.content ?? [];
    const tabText = extractStructuralElementsText(bodyContent);
    sections.push(`=== Guia: ${tab.tabProperties.title} ===\n${tabText}`);
    if (tab.childTabs && tab.childTabs.length > 0) {
      sections.push(extractTextFromTabs(tab.childTabs));
    }
  }
  return sections.join('\n\n');
}
