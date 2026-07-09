# Deploy do RPGMaster para uma VPS via SSH (Hostinger ou similar).
# Uso:
#   .\deploy\deploy.ps1 -SshHost root@2.24.211.17 -IdentityFile $env:USERPROFILE\.ssh\hostinger
#   .\deploy\deploy.ps1 -SshHost hostinger -RemoteDir /opt/rpgmaster -RegisterCommands
#
# O .env NUNCA é enviado nem sobrescrito: secrets ficam só em $RemoteDir/.env no servidor.
# Pré-requisitos no PC: OpenSSH client, tar (Windows 10+).
# Pré-requisitos na VPS: Docker + Docker Compose plugin (ver docs/deploy-hostinger.md).

param(
  [Parameter(Mandatory = $true)]
  [string]$SshHost,

  [string]$RemoteDir = "/opt/rpgmaster",

  [string]$IdentityFile = "",

  [switch]$RegisterCommands,

  [switch]$SkipUpload
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Get-SshArgs {
  $args = @()
  if ($IdentityFile) {
    $args += @("-i", $IdentityFile, "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no")
  }
  $args += @("-o", "BatchMode=yes", "-o", "ConnectTimeout=15")
  return $args
}

function Invoke-Remote {
  param([Parameter(Mandatory = $true)][string]$RemoteCommand)
  $sshArgs = Get-SshArgs
  & ssh @sshArgs $SshHost $RemoteCommand
  return $LASTEXITCODE
}

Write-Host "==> Testando SSH: $SshHost"
Invoke-Remote "echo ok" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Falha no SSH para '$SshHost'. Confirme o alias/IP, a chave (-IdentityFile) e o usuário (ex.: root@IP)."
}

if (-not $SkipUpload) {
  Write-Host "==> Enviando código para ${SshHost}:${RemoteDir}"
  Invoke-Remote "mkdir -p '$RemoteDir'" | Out-Null

  # No Windows o pipe tar|ssh corrompe o arquivo; usa tarball temporário + scp.
  # .env fica de fora do tarball — o arquivo no servidor não é tocado na extração.
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $localTar = Join-Path $env:TEMP "rpgmaster-deploy-$stamp.tar"
  $remoteTar = "/tmp/rpgmaster-deploy-$stamp.tar"
  try {
    $tarArgs = @(
      "-C", "$RepoRoot",
      "--exclude=node_modules",
      "--exclude=.git",
      "--exclude=.env",
      "--exclude=./.env",
      "--exclude=dist",
      "--exclude=*.log",
      "--exclude=.superpowers",
      "-cf", $localTar,
      "."
    )
    & tar @tarArgs
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar tarball local." }

    $sshArgs = Get-SshArgs
    & scp @sshArgs $localTar "${SshHost}:${remoteTar}"
    if ($LASTEXITCODE -ne 0) { throw "Falha no scp do tarball." }

    # Extrai só o código; sem .env no archive, $RemoteDir/.env existente é preservado.
    Invoke-Remote "tar xf '$remoteTar' -C '$RemoteDir' && rm -f '$remoteTar'" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair tarball no servidor." }
  }
  finally {
    if (Test-Path $localTar) { Remove-Item -Force $localTar }
  }
}

Write-Host "==> Verificando .env no servidor (não é enviado pelo deploy)"
$envCheck = (Invoke-Remote "test -f '$RemoteDir/.env' && echo yes || echo no" | Out-String).Trim()
if ($envCheck -eq "no") {
  Write-Host @"

AVISO: $RemoteDir/.env ainda não existe no servidor.
O deploy não copia .env — crie/edite esse arquivo só na VPS (ex.: a partir de .env.example).

Depois rode de novo:
  .\deploy\deploy.ps1 -SshHost $SshHost -IdentityFile <chave> -SkipUpload

"@
  exit 2
}

Write-Host "==> Subindo containers (build + up)"
Invoke-Remote "cd '$RemoteDir' && docker compose -f docker-compose.prod.yml up -d --build" | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "docker compose falhou no servidor. Veja logs com: docker compose -f docker-compose.prod.yml logs --tail=100"
}

if ($RegisterCommands) {
  Write-Host "==> Registrando comandos no Discord"
  Invoke-Remote "cd '$RemoteDir' && docker compose -f docker-compose.prod.yml run --rm --entrypoint sh bot -c 'npm run register-commands'" | Out-Host
}

Write-Host "==> Status"
Invoke-Remote "cd '$RemoteDir' && docker compose -f docker-compose.prod.yml ps" | Out-Host
Write-Host "Deploy concluído. Logs: docker compose -f docker-compose.prod.yml logs -f bot"
