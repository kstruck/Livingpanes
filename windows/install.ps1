# Build the Windows wallpaper app, install it in %LOCALAPPDATA%\Programs\Deskworlds
# with its own copy of the scenes, and start it now and at every sign-in.
# Runs in Windows PowerShell 5.1: powershell -ExecutionPolicy Bypass -File windows\install.ps1

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$project = Split-Path $here -Parent
$app = Join-Path $env:LOCALAPPDATA 'Programs\Deskworlds'
$exe = Join-Path $app 'Deskworlds.exe'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Error 'dotnet is missing. Install the .NET 10 SDK: https://dotnet.microsoft.com/download'
}

$build = Join-Path ([IO.Path]::GetTempPath()) ('deskworlds-build-' + [guid]::NewGuid())
try {
  dotnet publish (Join-Path $here 'Deskworlds\Deskworlds.csproj') -c Release -o $build --nologo -v quiet
  if ($LASTEXITCODE -ne 0) { Write-Error 'The build failed.' }

  # Stop a running copy so its files can be replaced.
  if (Test-Path $exe) {
    & $exe --quit
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Process Deskworlds -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
    }
    Get-Process Deskworlds -ErrorAction SilentlyContinue | Stop-Process -Force
  }

  if (Test-Path $app) { Remove-Item $app -Recurse -Force }
  New-Item -ItemType Directory -Force (Join-Path $app 'scene\scenes') | Out-Null
  Copy-Item (Join-Path $build '*') $app -Recurse
  Get-ChildItem (Join-Path $project 'scenes') -Directory | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $app 'scene\scenes') -Recurse
  }
  Copy-Item (Join-Path $project 'vendor'), (Join-Path $project 'ui') (Join-Path $app 'scene') -Recurse
  Get-ChildItem (Join-Path $app 'scene\scenes') -Directory -Recurse -Filter tests |
    Remove-Item -Recurse -Force
} finally {
  if (Test-Path $build) { Remove-Item $build -Recurse -Force }
}

# Start at sign-in.
Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Deskworlds -Value ('"' + $exe + '"')

Start-Process $exe
Write-Host "Deskworlds installed: $app"
Write-Host "Find it in the system tray (click ^ by the clock if it is hidden)."
