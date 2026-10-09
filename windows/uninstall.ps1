# Stops Livingpanes, removes it from sign-in, and deletes the app.
# Your own scenes, pets and API key are kept unless you add -RemoveData.
# Runs in Windows PowerShell 5.1 or later:
#   powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-RemoveData]

param([switch]$RemoveData)

$app = Join-Path $env:LOCALAPPDATA 'Programs\Livingpanes'
$exe = Join-Path $app 'Livingpanes.exe'

if (Test-Path $exe) { & $exe --quit }
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Process Livingpanes -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
}
Get-Process Livingpanes -ErrorAction SilentlyContinue | Stop-Process -Force

Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Livingpanes -ErrorAction SilentlyContinue
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Livingpanes'
if (Test-Path $menu) { Remove-Item $menu -Recurse -Force }
# This script may live inside the folder it deletes; PowerShell has already read it.
if (Test-Path $app) { Remove-Item $app -Recurse -Force -ErrorAction SilentlyContinue }

$data = Join-Path $env:LOCALAPPDATA 'Livingpanes'
if ($RemoveData) {
  if (Test-Path $data) { Remove-Item $data -Recurse -Force }
  Write-Host 'Livingpanes removed, with your scenes, pets and API key.'
} else {
  Write-Host 'Livingpanes removed. Your scenes, pets and API key are still in:'
  Write-Host "  $data"
  Write-Host 'Run again with -RemoveData to delete them too.'
}
