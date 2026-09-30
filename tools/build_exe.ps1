$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$tempRoot = Join-Path $env:TEMP "DesktopImpactBuild_$stamp"
$dist = Join-Path $tempRoot "dist"
$work = Join-Path $tempRoot "build"
$spec = Join-Path $tempRoot "spec"

New-Item -ItemType Directory -Force -Path $dist, $work, $spec | Out-Null
Set-Location $root

python -m PyInstaller `
  --noconfirm `
  --onefile `
  --windowed `
  --name "DesktopImpact" `
  --distpath $dist `
  --workpath $work `
  --specpath $spec `
  "$root\launcher.py"

if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller terminou com codigo $LASTEXITCODE."
}

$builtExe = Join-Path $dist "DesktopImpact.exe"
if (-not (Test-Path -LiteralPath $builtExe)) {
  throw "O executavel esperado nao foi criado: $builtExe"
}

Copy-Item -LiteralPath $builtExe -Destination "$root\DesktopImpact.exe" -Force
Write-Host "Executavel criado em $root\DesktopImpact.exe"
