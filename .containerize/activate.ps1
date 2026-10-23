# Containerize Environment Activation Script
$env:CONTAINERIZE_ACTIVE = '1'
$env:CONTAINERIZE_PROJECT_NAME = 'orion-tauri'
$env:CONTAINERIZE_PROJECT_DIR = 'C:\Projects\Orion\orion-tauri'
$env:PATH = 'C:\Projects\Orion\orion-tauri\.containerize\bin;' + $env:PATH

# Environment Variables
$env:NODE_ENV = 'development'

Write-Host '[Containerize]' -ForegroundColor Cyan -NoNewline
Write-Host ' Environment ' -NoNewline
Write-Host 'orion-tauri' -ForegroundColor Green -NoNewline
Write-Host ' activated (Isolated PATH injected).'
