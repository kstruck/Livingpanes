# Installs Livingpanes in %LOCALAPPDATA%\Programs\Livingpanes, adds it to sign-in, and
# starts it. Works two ways:
#   - from a release download: the folder already holds Livingpanes.exe and scene\
#   - from a clone of the repository: builds the app first (needs the .NET 10 SDK)
# Runs in Windows PowerShell 5.1 or later:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$app = Join-Path $env:LOCALAPPDATA 'Programs\Livingpanes'
$exe = Join-Path $app 'Livingpanes.exe'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Stop-Running([string]$path, [string]$name) {
  if (Test-Path $path) { & $path --quit }
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Process $name -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force
}

# Remove an early build that was called Deskworlds (its settings stay where they are).
$old = Join-Path $env:LOCALAPPDATA 'Programs\Deskworlds'
if (Test-Path (Join-Path $old 'Deskworlds.exe')) {
  Write-Host 'Removing the earlier Deskworlds build...'
  Stop-Running (Join-Path $old 'Deskworlds.exe') 'Deskworlds'
  Remove-ItemProperty $run -Name Deskworlds -ErrorAction SilentlyContinue
  Remove-Item $old -Recurse -Force
}
# Carry that build's choices (world, pause) over, once.
$oldSettings = Join-Path $env:LOCALAPPDATA 'Deskworlds\settings.json'
$newData = Join-Path $env:LOCALAPPDATA 'Livingpanes'
if ((Test-Path $oldSettings) -and -not (Test-Path (Join-Path $newData 'settings.json'))) {
  New-Item -ItemType Directory -Force $newData | Out-Null
  Copy-Item $oldSettings $newData
}

$prebuilt = Test-Path (Join-Path $here 'Livingpanes.exe')
$build = $null
try {
  if ($prebuilt) {
    $source = $here
    $project = $here
  } else {
    $project = Split-Path $here -Parent
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
      throw 'The .NET 10 SDK is needed to build from source: https://dotnet.microsoft.com/download (or download a release instead).'
    }
    $build = Join-Path ([IO.Path]::GetTempPath()) ('livingpanes-build-' + [guid]::NewGuid())
    Write-Host 'Building Livingpanes...'
    dotnet publish (Join-Path $here 'Livingpanes\Livingpanes.csproj') -c Release -o $build --nologo -v quiet
    if ($LASTEXITCODE -ne 0) { throw 'The build failed. Run the command above without -v quiet to see why.' }
    $source = $build
  }

  Stop-Running $exe 'Livingpanes'
  if (Test-Path $app) { Remove-Item $app -Recurse -Force }
  New-Item -ItemType Directory -Force $app | Out-Null
  Get-ChildItem $source -File | Where-Object { $_.Name -notin @('install.ps1', 'uninstall.ps1') } |
    Copy-Item -Destination $app
  Get-ChildItem $source -Directory | Where-Object { $_.Name -ne 'scene' } | Copy-Item -Destination $app -Recurse

  $scene = Join-Path $app 'scene'
  if ($prebuilt) {
    Copy-Item (Join-Path $source 'scene') $app -Recurse
  } else {
    New-Item -ItemType Directory -Force (Join-Path $scene 'scenes') | Out-Null
    Get-ChildItem (Join-Path $project 'scenes') -Directory | Copy-Item -Destination (Join-Path $scene 'scenes') -Recurse
    foreach ($folder in 'vendor', 'ui', 'studio') { Copy-Item (Join-Path $project $folder) $scene -Recurse }
  }
  Get-ChildItem $scene -Directory -Recurse -Filter tests | Remove-Item -Recurse -Force
  Copy-Item (Join-Path $here 'uninstall.ps1') $app -ErrorAction SilentlyContinue
} finally {
  if ($build -and (Test-Path $build)) { Remove-Item $build -Recurse -Force }
}

Set-ItemProperty $run -Name Livingpanes -Value ('"' + $exe + '"')
Start-Process $exe
Write-Host ''
Write-Host "Livingpanes installed: $app"
Write-Host 'Look for its icon in the system tray, next to the clock (click ^ if it is hidden).'
