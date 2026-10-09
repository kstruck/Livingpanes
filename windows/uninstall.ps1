# Stop Deskworlds, remove it from sign-in, and delete the app and its settings.
# Runs in Windows PowerShell 5.1: powershell -ExecutionPolicy Bypass -File windows\uninstall.ps1

$app = Join-Path $env:LOCALAPPDATA 'Programs\Deskworlds'
$exe = Join-Path $app 'Deskworlds.exe'

if (Test-Path $exe) { & $exe --quit }
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Process Deskworlds -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
}
Get-Process Deskworlds -ErrorAction SilentlyContinue | Stop-Process -Force

Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Deskworlds -ErrorAction SilentlyContinue
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
$data = Join-Path $env:LOCALAPPDATA 'Deskworlds'
if (Test-Path $data) { Remove-Item $data -Recurse -Force }
Write-Host 'Deskworlds removed.'
