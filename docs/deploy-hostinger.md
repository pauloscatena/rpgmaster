# Deploy na VPS Hostinger (RPGMaster)

O RPGMaster é um **bot Discord + Postgres**. Não há site/frontend nem porta HTTP pública. Na VPS basta Docker: o bot sai para a API do Discord; o Postgres fica só na rede interna do Compose.

## O que sobe

| Serviço | Função |
|---------|--------|
| `db` | Postgres 16 (volume persistente, sem porta no host) |
| `ollama` | LLM local na rede interna do Compose (sem porta no host) |
| `bot` | Node 20: migra o schema e conecta no Discord |

Arquivos: `Dockerfile.prod`, `docker-compose.prod.yml`, `deploy/deploy.ps1`, `deploy/setup-vps.sh`.

## Pré-requisitos

1. VPS Hostinger com Ubuntu (ou Debian) e acesso SSH.
2. No PC Windows: OpenSSH (`ssh`) e `tar` (já vêm no Windows 10/11).
3. Segredos: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `ANTHROPIC_API_KEY`, e uma `POSTGRES_PASSWORD` forte.

## 1. Configurar SSH no Windows

Não há `~/.ssh/config` neste ambiente e nenhuma entrada Hostinger em `known_hosts`. Crie o alias (ajuste IP/usuário/chave):

```powershell
# C:\Users\Paulo\.ssh\config
Host hostinger
    HostName SEU_IP_DA_VPS
    User root
    IdentityFile ~/.ssh/hostinger
```

Teste:

```powershell
ssh -i $env:USERPROFILE\.ssh\hostinger root@SEU_IP_DA_VPS "echo SSH_OK"
# ou, com o Host no config: ssh hostinger
```

Se a chave for outra, aponte `IdentityFile` para ela ou gere uma chave só para a Hostinger e cole a `.pub` no painel / `authorized_keys` da VPS.

## 2. Preparar a VPS (uma vez)

```bash
ssh hostinger
# cole o conteúdo de deploy/setup-vps.sh, ou:
curl -fsSL https://get.docker.com | sh   # alternativa rápida
# ou envie e rode: bash /opt/rpgmaster/deploy/setup-vps.sh
```

Firewall (UFW): abra só SSH. **Não** precisa abrir 80/443/5432 para este bot.

```bash
ufw allow OpenSSH
ufw enable
```

## 3. Criar o `.env` no servidor

No primeiro deploy o script avisa se faltar `.env`. Crie em `/opt/rpgmaster/.env`:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
# Opcional em prod: deixe vazio para registro global de comandos
DISCORD_GUILD_ID=

ANTHROPIC_API_KEY=...
# Claude (API) ou ollama (serviço no Compose)
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:7b

# Senha forte — usada pelo Compose para o Postgres e para montar DATABASE_URL
POSTGRES_USER=rpgmaster
POSTGRES_PASSWORD=troque-por-senha-forte
POSTGRES_DB=rpgmaster

# DATABASE_URL no .env é sobrescrito pelo compose em produção (aponta para o serviço db).
# Pode deixar o valor do .env.example; não precisa apontar para localhost.
DATABASE_URL=postgres://rpgmaster:troque-por-senha-forte@db:5432/rpgmaster
```

Com `LLM_PROVIDER=ollama`, o bot fala com o hostname `ollama` na rede do Compose. **Não** use `host.docker.internal` nem publique `11434` na internet. Após o primeiro `up`, baixe o modelo:

```bash
cd /opt/rpgmaster
docker compose -f docker-compose.prod.yml exec ollama ollama pull qwen2.5:7b
```

### Performance do Ollama (CPU-only)

Em VPS sem GPU (ex.: 4 vCPU), `qwen2.5:7b` (Q4_K_M) roda ~10–25 tok/s. Expectativa realista: **vários segundos a dezenas** por resposta narrativa; o salto grande só vem com GPU ou modelo menor (`qwen2.5:3b`).

O `docker-compose.prod.yml` já define defaults sensatos no serviço `ollama`:

| Variável | Default | Efeito |
|----------|---------|--------|
| `OLLAMA_NUM_THREAD` | `4` | Threads de inferência (= vCPUs) |
| `OLLAMA_KEEP_ALIVE` | `-1` | Mantém o modelo na RAM (evita reload de ~8–40s) |
| `OLLAMA_NUM_PARALLEL` | `1` | Um request por vez (menos RAM) |
| `OLLAMA_CONTEXT_LENGTH` | `4096` | Contexto padrão (modelo aceita 32k; KV cache menor = mais rápido) |

No `.env` do **bot** (opcional):

| Variável | Default | Efeito |
|----------|---------|--------|
| `LLM_REQUEST_TIMEOUT_MS` | `90000` | Timeout por chamada (tool loops em CPU) |
| `OLLAMA_NUM_PREDICT` | `512` | Cap de tokens gerados |
| `OLLAMA_NUM_CTX` | `4096` | `num_ctx` por request |
| `OLLAMA_NUM_THREAD` | `4` | `num_thread` por request |

O prompt do mestre inclui lore + resumo de sessão (resumo já limitado a ~4000 chars). Lore enorme deixa o prompt_eval mais lento — evite colar documentos inteiros na lore da campanha.

Nunca commite o `.env`. O `deploy.ps1` **não** envia nem sobrescreve o `.env`: secrets são gerenciados só no servidor (`/opt/rpgmaster/.env`). O tarball exclui `.env`; atualizações de deploy tocam só código e compose.

## 4. Deploy a partir do Windows

Na pasta do repositório:

```powershell
.\deploy\deploy.ps1 -SshHost root@SEU_IP -IdentityFile $env:USERPROFILE\.ssh\hostinger
```

Na primeira vez, depois do `.env` criado:

```powershell
.\deploy\deploy.ps1 -SshHost root@SEU_IP -IdentityFile $env:USERPROFILE\.ssh\hostinger -RegisterCommands
```

`-RegisterCommands` registra os slash commands no Discord (rode de novo só quando mudar comandos).

Atualizações seguintes:

```powershell
.\deploy\deploy.ps1 -SshHost root@SEU_IP -IdentityFile $env:USERPROFILE\.ssh\hostinger
```

## 5. Verificar

```powershell
ssh hostinger "cd /opt/rpgmaster && docker compose -f docker-compose.prod.yml ps"
ssh hostinger "cd /opt/rpgmaster && docker compose -f docker-compose.prod.yml logs -f bot"
```

No log deve aparecer algo como: `Bot conectado como NomeDoBot#1234`.

No Discord: use um slash command (`/criar-campanha`, etc.).

## DNS / HTTPS

Não são necessários para o bot. Só faria sentido se no futuro houver um painel web na mesma VPS.

## Alternativa: git pull na VPS

Se o repo no GitHub estiver acessível da VPS (público ou deploy key):

```bash
ssh hostinger
git clone https://github.com/pauloscatena/rpgmaster.git /opt/rpgmaster
# configure .env, depois:
cd /opt/rpgmaster
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh bot -c 'npm run register-commands'
```

Atualizar: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

O branch local pode estar à frente do `origin`; faça push antes se for usar esse fluxo (só quando você pedir).

## Troubleshooting

| Sintoma | O que checar |
|---------|----------------|
| SSH falha | IP, usuário, `IdentityFile`, chave na VPS |
| Bot reinicia em loop | `docker compose ... logs bot` — token, API key, migrate |
| Comandos não aparecem | `-RegisterCommands`; se global, pode levar até ~1h; use `DISCORD_GUILD_ID` para teste rápido |
| Postgres | volume `rpgmaster-db-data`; senha no `.env` deve bater com o volume já criado (trocar senha depois exige recriar volume — apaga dados) |
| Ollama lento / timeout | Normal em CPU: veja seção Performance; `docker compose ... exec ollama ollama ps` (CONTEXT/UNTIL); keep_alive=-1; se ainda lento demais, `OLLAMA_MODEL=qwen2.5:3b` + `ollama pull` |
