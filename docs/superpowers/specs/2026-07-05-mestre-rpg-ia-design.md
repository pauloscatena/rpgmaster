# Mestre de RPG por IA — Design

## Visão geral

Um bot de Discord que atua como mestre de RPG (Game Master) para grupos de 3 a 5 jogadores, em sessões de tempo real (todos online ao mesmo tempo, sessão marcada). O bot narra a aventura, controla NPCs, gerencia fichas de personagem e conduz combate por turnos, usando um LLM (Claude) para a narrativa e um motor de regras em código para toda a matemática do jogo (dados, dano, HP, turnos).

O projeto é pensado para ser usado por múltiplos servidores Discord, cada canal/thread hospedando uma campanha isolada. Cada campanha pode usar o sistema de regras simplificado padrão ou um sistema de regras próprio, extraído a partir de um documento (lore + regras caseiras) enviado pelo criador da campanha.

### Objetivo do MVP

- Narrativa livre por texto, com testes de dado resolvidos em código.
- Fichas de personagem (atributos, HP, inventário simples).
- Combate básico por turnos com iniciativa.
- Suporte a múltiplos servidores/campanhas desde o início.
- Suporte a upload de documento de campanha (lore + regras customizadas).

### Fora de escopo (por ora)

- Jogo assíncrono/play-by-post (só tempo real no MVP).
- Combate tático com mapa/grade (posição, alcance, área de efeito).
- Voz (STT/TTS) — só texto.
- Editor visual de fichas/regras — a configuração de regras é extraída via documento ou template padrão, sem UI dedicada de edição no MVP.

## Arquitetura

```
Discord (guild/canal/thread)
        │
        ▼
Bot (Node.js/TypeScript, discord.js)
        │
        ├──► Claude API (Anthropic SDK, tool use) — "cérebro" do mestre
        │         │
        │         ▼
        │    Motor de regras (módulo puro, sem I/O)
        │    - fazer_teste (dado + fórmula do ruleset_config)
        │    - resolver_ataque / aplicar_dano
        │    - avancar_turno (iniciativa)
        │    - consultar_ficha / atualizar_inventario
        │
        ▼
Postgres — estado persistente
   - campanhas (1 por canal/thread do Discord; chave guild_id + channel_id)
   - lore da campanha (texto livre, usado como contexto do LLM)
   - ruleset_config (JSON estruturado: atributos, fórmula de teste, recursos)
   - fichas de personagem (atributos, HP, inventário)
   - estado de combate (ordem de turno, alvo atual)
   - histórico/resumo da sessão (continuidade entre sessões)
```

### Ingestão de documento de campanha

Quando a campanha é criada com um documento anexado (PDF/texto contendo lore e/ou regras caseiras), roda um pipeline de ingestão **uma única vez**, na criação da campanha (nunca durante o jogo):

1. Claude lê o documento inteiro.
2. Extrai a lore/cenário como texto livre — vira contexto injetado nas narrações.
3. Extrai a lógica de pontos como `ruleset_config` estruturado: quais atributos existem, fórmula de teste (ex: d20 + atributo vs dificuldade), quais recursos existem (HP, mana, sanidade etc.) e como se comportam.
4. Se a extração ficar ambígua ou incompleta (ex: não fica claro qual dado usar), a campanha entra em estado "rascunho" e o bot faz perguntas objetivas no canal até fechar a configuração. Nunca assume um valor arbitrário sem sinalizar.
5. Sem documento, a campanha usa um `ruleset_config` padrão (sistema simplificado: atributos básicos, HP, teste de d20 + atributo).

O motor de regras não é mais um sistema fixo único — é um **executor genérico de um schema de regras**, parametrizado por campanha via `ruleset_config`. Isso preserva a garantia central da arquitetura: o LLM nunca inventa números de jogo, mesmo quando as regras da campanha são customizadas.

## Componentes e fluxo de dados

### Criação de campanha
1. `/criar-campanha` no Discord, com documento opcional anexado.
2. Com documento → pipeline de ingestão (lore + `ruleset_config`, com perguntas de esclarecimento se necessário).
3. Sem documento → `ruleset_config` padrão.
4. Persistido em Postgres, indexado por `guild_id` + `channel_id` — isola campanhas por canal/thread, dando multi-tenant nativo.

### Criação de personagem
- `/criar-personagem` lê o `ruleset_config` da campanha corrente e monta um formulário dinâmico de acordo com os atributos/recursos definidos ali. Ficha vinculada a jogador + campanha.

### Sessão em tempo real — fora de combate
1. Jogador escreve livremente no canal.
2. Bot envia ao Claude: mensagem do jogador + resumo da cena + lore relevante + ficha do personagem.
3. Se a ação exige teste, Claude chama a tool `fazer_teste` → motor de regras rola conforme o `ruleset_config` da campanha → devolve resultado exato → Claude narra em cima do resultado.
4. Sem teste necessário, Claude apenas narra.

### Sessão em tempo real — combate
1. Início de combate: motor de regras calcula iniciativa e salva estado de turno.
2. Bot anuncia de quem é o turno (ping do jogador); ações fora de ordem são recusadas pelo bot, sem passar pelo Claude decidir.
3. Na sua vez, o jogador age em texto livre; Claude interpreta a intenção e chama as tools necessárias (`resolver_ataque`, `aplicar_dano` etc.); motor de regras calcula tudo; Claude narra o resultado; bot avança o turno.

### Tools do motor de regras
Funções puras, sem I/O direto com Discord, que leem `ruleset_config` + estado do personagem: `fazer_teste`, `resolver_ataque`, `aplicar_dano`, `avancar_turno`, `consultar_ficha`, `atualizar_inventario`.

## Tratamento de erros

- **Documento ambíguo na ingestão**: campanha fica em "rascunho"; bot faz perguntas objetivas até fechar o `ruleset_config`. Nunca assume valores não confirmados.
- **Ação fora de turno em combate**: motor de regras rejeita a chamada; bot informa de quem é a vez, sem envolver o Claude nessa decisão.
- **Ação mecanicamente inválida** (sem munição, recurso esgotado etc.): motor de regras retorna falha explícita; Claude narra a falha dentro da ficção, em vez de travar a interação para o jogador.
- **Instabilidade da API do Claude** (rate limit, timeout, 5xx): bot avisa que "o mestre está pensando", tenta novamente com backoff; após falhas repetidas, avisa os jogadores em vez de travar silenciosamente ou inventar uma resposta.
- **Chamada de tool malformada**: bot valida o formato antes de aplicar qualquer mutação de estado; se inválida, descarta e solicita nova tentativa ao modelo — nunca aplica mutação não validada no Postgres.
- **Concorrência**: fora de combate, mensagens são processadas em ordem de chegada por campanha; em combate, a ordem é estritamente serializada por turno.

## Estratégia de testes

- **Motor de regras**: testes unitários puros — rolagem de dado com RNG semeado, fórmulas de dano, ordenação de iniciativa, validação de `ruleset_config` (casos válidos e incompletos).
- **Pipeline de ingestão**: testes com documentos de exemplo (sistema claro e documento propositalmente ambíguo), conferindo que o config extraído bate com o esperado e que o caminho de esclarecimento dispara quando devido.
- **Camada de tool-calling**: testes de integração com chamadas de tool do Claude mockadas, conferindo aplicação correta de mutações no Postgres e rejeição de chamadas malformadas.
- **Bot Discord**: cobertura de unidade nos handlers de comando (parsing de `/criar-campanha`, `/atacar` etc.); integração real com o gateway validada manualmente em servidor de teste.
- **Ponta a ponta**: playtesting manual em servidor Discord de teste — uma cena narrativa livre e um combate completo (iniciativa → ações → derrota de um inimigo), incluindo o caso de ação fora de turno.

## Stack técnica

- **Bot**: Node.js + TypeScript, discord.js.
- **LLM**: Claude API (Anthropic SDK), com tool use.
- **Banco de dados**: Postgres (gerenciado — Supabase/Neon/Railway).
- **Hospedagem**: processo sempre ativo (Railway, Fly.io ou VPS), já que o bot mantém conexão persistente com o gateway do Discord.
