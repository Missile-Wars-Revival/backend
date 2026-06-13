# Phase 12 updater for a self-hosted Missile Wars shard (git-checkout mode), Windows.
#
# Run automatically by runners/coordinatorClient.ts when the coordinator says an
# update is available/required, OR manually:  .\docker\update.ps1
#
# Mirrors docker/update.sh: fetch the approved release tag/commit, verify the
# version, rebuild (preserving .env + the Postgres volume), migrate, restart,
# health-check, and roll back on failure (writing docker/.update-result.json so
# the failure is reported in the next heartbeat). Requires `docker compose` and
# `git` to work for this checkout (run on the host).

$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')  # backend/ repo root

$ResultFile = 'docker\.update-result.json'
$LockFile = 'docker\.update.lock'

function Read-Version {
  try { return (node -e 'console.log(require("./package.json").version)' 2>$null) }
  catch { return ((Get-Content package.json -Raw | Select-String '"version"\s*:\s*"([^"]*)"').Matches.Groups[1].Value) }
}

$From = if ($env:UPDATE_FROM_VERSION) { $env:UPDATE_FROM_VERSION } else { Read-Version }
$To = $env:RELEASE_VERSION
$NowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

function Fail([string]$reason) {
  $obj = @{ ok = $false; fromVersion = "$From"; toVersion = "$To"; reason = $reason; at = $NowMs }
  ($obj | ConvertTo-Json -Compress) | Out-File -Encoding utf8 $ResultFile
  Remove-Item $LockFile -ErrorAction SilentlyContinue
  Write-Host "[update] FAILED: $reason"
  exit 1
}

if (Test-Path $LockFile) {
  Write-Host "[update] another update is already running ($LockFile present) - exiting."
  exit 0
}
"$NowMs" | Out-File -Encoding ascii $LockFile

try {
  $compose = $null
  docker compose version *> $null
  if ($LASTEXITCODE -eq 0) { $compose = 'docker compose' }
  elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { $compose = 'docker-compose' }
  else { Fail 'docker compose not found' }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found' }
  $prev = (git rev-parse HEAD 2>$null)
  if (-not $prev) { Fail 'not a git checkout (cannot determine current commit)' }

  Write-Host "[update] $From -> $(if ($To) { $To } else { 'latest' })  (current commit $($prev.Substring(0,8)))"

  # 1. Fetch.
  git fetch --tags --force origin *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'git fetch failed' }

  # Prefer the annotated release tag; fall back to the pinned SHA.
  $ref = $null
  if ($To) {
    git rev-parse --verify --quiet "backend-v$To^{commit}" *> $null
    if ($LASTEXITCODE -eq 0) { $ref = "backend-v$To" }
  }
  if (-not $ref -and $env:RELEASE_GIT_SHA) { $ref = $env:RELEASE_GIT_SHA }
  if (-not $ref) { Fail "no matching release tag (backend-v$To) or RELEASE_GIT_SHA to check out" }

  git checkout --quiet $ref *> $null
  if ($LASTEXITCODE -ne 0) { Fail "git checkout $ref failed" }

  # 2. Verify version.
  $newv = Read-Version
  if ($To -and $newv -ne $To) {
    git checkout --quiet $prev *> $null
    Fail "version mismatch: checked out $newv, expected $To"
  }

  # 3-6. Rebuild + migrate + restart (preserves .env + db-data volume).
  Invoke-Expression "$compose up -d --build"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[update] build/start failed - rolling back"
    git checkout --quiet $prev *> $null
    Invoke-Expression "$compose up -d --build" *> $null
    Fail 'docker compose up failed'
  }

  # 7. Health check.
  $port = '8080'
  if (Test-Path .env) {
    $m = (Get-Content .env | Select-String '^\s*PORT=(.*)$')
    if ($m) { $port = $m.Matches[-1].Groups[1].Value.Trim() }
  }
  $healthy = $false
  foreach ($i in 1..30) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$port/healthz" *> $null
      $healthy = $true; break
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $healthy) {
    Write-Host "[update] new version unhealthy - rolling back"
    git checkout --quiet $prev *> $null
    Invoke-Expression "$compose up -d --build" *> $null
    Fail 'health check failed after update; rolled back'
  }

  # 8. Success. The restarted backend heartbeats $newv on boot.
  Remove-Item $ResultFile -ErrorAction SilentlyContinue
  Write-Host "[update] OK - now running v$newv"
}
finally {
  Remove-Item $LockFile -ErrorAction SilentlyContinue
}
