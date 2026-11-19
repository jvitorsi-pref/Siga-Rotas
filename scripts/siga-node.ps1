<#
.SYNOPSIS
  Gerencia o processo Node.js central do Siga-Rotas no Windows sem exigir
  privilegios administrativos nem `npm install` (o servidor usa apenas modulos
  nativos do Node >= 20).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\siga-node.ps1 -Action ensure
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\siga-node.ps1 -Action status
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\siga-node.ps1 -Action stop
#>
param(
  [ValidateSet('ensure', 'start', 'stop', 'status')]
  [string]$Action = 'ensure',
  [string]$BindHost = '127.0.0.1',
  [int]$Port = 8094,
  [string]$CorsOrigins = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ServerScript = Join-Path $RepoRoot 'server\index.js'
$DataDir = Join-Path $RepoRoot 'data'
$PidFile = Join-Path $DataDir 'siga-node.pid'
$LogOut = Join-Path $DataDir 'siga-node.out.log'
$LogErr = Join-Path $DataDir 'siga-node.err.log'
$HealthHost = if ($BindHost -eq '0.0.0.0') { '127.0.0.1' } else { $BindHost }
$HealthUrl = "http://${HealthHost}:${Port}/api/health"

function Find-NodeExe {
  $candidates = @()
  if ($env:SIGA_NODE_EXE) { $candidates += $env:SIGA_NODE_EXE }
  $candidates += @(
    (Join-Path $RepoRoot 'runtime\node.exe'),
    (Join-Path $RepoRoot 'node\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd2 = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd2) { return $cmd2.Source }
  throw 'Binario node.exe nao encontrado. Defina SIGA_NODE_EXE ou coloque node.exe em runtime\node.exe.'
}

function Test-ServerHealth {
  try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 2 -UseBasicParsing
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-RunningPid {
  if (-not (Test-Path $PidFile)) { return $null }
  $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if (-not ($raw -match '^\d+$')) { return $null }
  $procId = [int]$raw
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) { return $procId }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  return $null
}

if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

switch ($Action) {
  'status' {
    $pidRunning = Get-RunningPid
    $healthy = Test-ServerHealth
    Write-Output ("PID: {0} | Health ({1}): {2}" -f ($pidRunning ?? 'nenhum'), $HealthUrl, ($healthy ? 'OK' : 'INDISPONIVEL'))
    if (-not $healthy) { exit 1 }
    exit 0
  }
  'stop' {
    $pidRunning = Get-RunningPid
    if ($pidRunning) {
      Stop-Process -Id $pidRunning -Force -ErrorAction SilentlyContinue
      Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
      Write-Output "Servidor Node.js encerrado (PID $pidRunning)."
    } else {
      Write-Output 'Nenhum servidor Node.js em execucao por este script.'
    }
    exit 0
  }
  default {
    if ($Action -eq 'ensure' -and (Test-ServerHealth)) {
      Write-Output "Servidor Node.js ja ativo em $HealthUrl."
      exit 0
    }
    $existingPid = Get-RunningPid
    if ($existingPid) {
      if ($Action -eq 'start') {
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
      } elseif (Test-ServerHealth) {
        Write-Output "Servidor Node.js ativo (PID $existingPid)."
        exit 0
      }
    }

    $nodeExe = Find-NodeExe
    $argList = @("`"$ServerScript`"", '--host', $BindHost, '--port', "$Port")
    if ($CorsOrigins) {
      $argList += @('--cors-origins', "`"$CorsOrigins`"")
    }

    $proc = Start-Process -FilePath $nodeExe -ArgumentList $argList `
      -WorkingDirectory $RepoRoot -WindowStyle Hidden `
      -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr -PassThru
    Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII

    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 250
      if (Test-ServerHealth) {
        Write-Output "Servidor Node.js iniciado (PID $($proc.Id)) em $HealthUrl."
        exit 0
      }
    }
    Write-Warning "Servidor iniciado (PID $($proc.Id)), mas ainda nao respondeu em $HealthUrl. Consulte $LogErr."
    exit 0
  }
}
