# Referência a Google Docs na criação de campanha — Design

## Visão geral

Hoje `/criar-campanha` aceita um documento de campanha (lore + regras caseiras) apenas como arquivo anexado (`.txt`/`.pdf`). Esta feature adiciona uma segunda forma de fornecer esse documento: uma referência a um Google Docs, incluindo todo o conteúdo distribuído em guias (tabs) do documento — não só a guia principal.

O documento pode ser a "bíblia" viva da campanha (lore completa, livro do mestre, etc.), organizado em várias guias dentro de um único Google Docs. O bot precisa entender tudo isso, independente de como o conteúdo está formatado ou dividido — mesmo princípio já registrado para documentos anexados (ver `feedback_rpgmaster_document_format_flexibility`).

### Objetivo

- Nova opção `link` em `/criar-campanha`, alternativa ao anexo `documento` já existente.
- Buscar o texto de **todas as guias** do Google Docs referenciado (incluindo sub-guias aninhadas), via API oficial do Google Docs com autenticação de conta de serviço.
- Reutilizar 100% do pipeline de ingestão já existente (extração via Claude, fallback padrão, perguntas de esclarecimento, trava com `/iniciar-campanha`) — a única mudança é de onde vem o texto bruto do documento.

### Fora de escopo

- Re-sincronizar/atualizar uma campanha já criada a partir de uma nova versão do Google Docs (fica para uma feature futura, se necessário).
- Suporte a outros formatos do Google Workspace (Planilhas, Apresentações).
- Fluxo de autorização OAuth interativo por usuário — a autenticação é sempre via uma única conta de serviço configurada pelo operador do bot.
- Preservar formatação/estrutura visual (tabelas, estilos) do Google Docs — assim como no PDF, extrai-se texto corrido.

## Arquitetura

```
/criar-campanha nome:"..." link:"https://docs.google.com/document/d/.../edit"
        │
        ▼
src/bot/google-docs.ts
   - extrai o ID do documento a partir do link (regex sobre a URL)
   - autentica como conta de serviço (JWT via google-auth-library)
   - chama a API do Google Docs v1 (documents.get, includeTabsContent=true)
   - percorre a árvore de guias (guias podem ter sub-guias) recursivamente
   - extrai o texto de cada guia (parágrafos e células de tabela, texto corrido)
   - concatena tudo, prefixando cada guia com "=== Guia: <título> ==="
        │
        ▼
documentText: string   ← mesmo tipo que fetchAttachmentText já produz
        │
        ▼
extractResolvedConfig()  (já existe, sem alterações)
        │
        ▼
mesmo fluxo de rascunho / perguntas de esclarecimento / /iniciar-campanha (sem alterações)
```

Em `criar-campanha.ts`, `link` é uma nova opção de string, opcional, mutuamente exclusiva com o anexo `documento`. Fora a origem do texto, nenhuma outra parte do pipeline de ingestão muda.

## Componentes e fluxo de dados

**Extração do ID do documento:** regex `/\/document\/d\/([a-zA-Z0-9_-]+)/` sobre a URL fornecida. Se não bater, erro claro pedindo um link válido do Google Docs.

**Autenticação:** `google-auth-library` gera um JWT assinado a partir da chave da conta de serviço (e-mail + chave privada, vindos de `GOOGLE_SERVICE_ACCOUNT_KEY`) e troca por um token de acesso — a lib já implementa esse fluxo, sem precisar reimplementar o protocolo.

**Busca do documento:** `GET https://docs.googleapis.com/v1/documents/{ID}?includeTabsContent=true`, com o token de acesso no header `Authorization: Bearer <token>`. A resposta traz `tabs[]`; cada guia tem `tabProperties.title`, `documentTab.body.content` (parágrafos e tabelas) e `childTabs[]` (sub-guias).

**Extração de texto (função pura, recursiva):** percorre `tabs[]` em ordem (e `childTabs[]` de cada uma, recursivamente), extraindo para cada guia o texto de parágrafos e de células de tabela (texto corrido, sem preservar alinhamento), prefixado com `=== Guia: <título> ===`. O resultado de todas as guias é concatenado em uma única string, na ordem em que aparecem no documento.

**Mudança em `criar-campanha.ts`:**
- Nova opção `link` (string, opcional) no `SlashCommandBuilder`.
- Se `link` e `documento` vierem juntos → erro pedindo para escolher um.
- Se só `link` vier → chama `fetchGoogleDocText(link, config.googleServiceAccountKey)` em vez de `fetchAttachmentText(...)`; o restante do fluxo (criação da campanha em rascunho, `formatDraftSummary`, divisão de mensagens longas) é idêntico ao caminho de anexo.
- Se nenhum dos dois vier → comportamento atual inalterado (ruleset padrão + lore aleatória).

**Configuração:** `Config` ganha um campo opcional `googleServiceAccountKey?: string` (JSON da conta de serviço, em base64 na variável de ambiente `GOOGLE_SERVICE_ACCOUNT_KEY`, decodificado e parseado em `loadConfig`). Diferente de `anthropicApiKey`, este campo é opcional — sua ausência não impede o bot de subir, só desativa o caminho `link` com um erro claro no momento do uso.

## Setup de credenciais (pré-requisito manual, único)

Não automatizável por mim (sem acesso ao Google Cloud Console) — passo manual do operador do bot, feito uma vez:

1. Criar/usar um projeto no Google Cloud Console.
2. Ativar a Google Docs API nesse projeto.
3. Criar uma conta de serviço e gerar uma chave JSON para ela.
4. Compartilhar cada Google Docs a ser referenciado com o e-mail da conta de serviço (ex: `rpgmaster-bot@projeto.iam.gserviceaccount.com`), como leitor.
5. Colar o JSON da chave, codificado em base64, na variável de ambiente `GOOGLE_SERVICE_ACCOUNT_KEY`.

O passo a passo exato (nomes de tela do Console) é fornecido durante a implementação, não faz parte deste documento de design.

## Tratamento de erros

- **Link inválido** (não reconhecido como URL de Google Docs): erro claro pedindo um link válido.
- **`link` e `documento` informados juntos**: erro pedindo para escolher só um.
- **`GOOGLE_SERVICE_ACCOUNT_KEY` não configurada**: erro claro dizendo que esse recurso não está disponível no momento — não afeta o restante do bot.
- **Documento não compartilhado com a conta de serviço** (API devolve 403): erro incluindo o e-mail exato da conta de serviço (lido da própria chave em tempo de execução) e a instrução para compartilhar o documento como leitor.
- **Documento não encontrado** (ID inválido ou documento deletado — API devolve 404): erro claro pedindo para conferir o link.
- **Qualquer outra falha** (rede, erro inesperado da API): cai no mesmo fallback amigável já existente para documentos anexados ("Não consegui processar o documento da campanha. Tente novamente...").

## Estratégia de testes

- **Extração de ID da URL**: testes unitários cobrindo links válidos (com/sem parâmetros extras como `?tab=t.0`) e inválidos.
- **Extração de texto da árvore de guias**: testes unitários com JSON fabricado simulando respostas da API — uma guia simples, múltiplas guias irmãs, guias aninhadas (`childTabs`), parágrafos e células de tabela — confirmando que nenhuma guia é perdida e que os marcadores `=== Guia: ... ===` aparecem na ordem certa.
- **`fetchGoogleDocText`**: testes com `google-auth-library` e `fetch` mockados, cobrindo o caminho de sucesso (concatenação multi-guia) e os erros 403/404 (mensagens claras, incluindo o e-mail da conta de serviço no caso 403).
- **`criar-campanha.ts`**: testes espelhando os já existentes para anexos — cria campanha em rascunho a partir do link, recusa quando `link` e `documento` vêm juntos, erro amigável quando a conta de serviço não está configurada, erro amigável em falha genérica.

## Self-Review

**Cobertura**: todas as seções (arquitetura, fluxo de dados, setup, erros, testes) foram escritas sem placeholders. **Consistência**: a extração de texto reaproveita o mesmo `documentText: string` que já flui para `extractResolvedConfig`, sem exigir nenhuma mudança no pipeline de extração/rascunho existente. **Escopo**: contido a um novo módulo (`src/bot/google-docs.ts`) mais uma extensão pontual em `criar-campanha.ts` e `config.ts` — adequado para um único plano de implementação. **Ambiguidade**: nenhuma identificada — a extração de texto ignora formatação/tabelas intencionalmente (mesmo tratamento já dado a PDFs), e a ausência de credenciais é tratada como "recurso indisponível", não como falha de inicialização do bot.
