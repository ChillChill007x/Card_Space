# Dot-source this file to keep these settings in the current PowerShell session:
# . .\scripts\use-e-drive.ps1
$cardspaceRoot = Split-Path -Parent $PSScriptRoot
$cardspaceRuntime = Join-Path $cardspaceRoot '.local-runtime'
$env:TEMP = Join-Path $cardspaceRuntime 'temp'
$env:TMP = $env:TEMP
$env:NPM_CONFIG_CACHE = Join-Path $cardspaceRuntime 'npm-cache'
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:NPM_CONFIG_CACHE | Out-Null
Write-Host "Temporary files: $env:TEMP"
Write-Host "npm cache: $env:NPM_CONFIG_CACHE"
