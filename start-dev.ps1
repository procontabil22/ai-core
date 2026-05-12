# Sobe Docker containers
docker start focused_noether 2>$null
docker start ai-core-redis 2>$null
Start-Sleep 2

# Sobe ai-core pipeline
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\Administrador\dyad-apps\ai-core; node src\server.js"
Start-Sleep 3

# Escolha do projeto
Write-Host ""
Write-Host "Qual projeto deseja abrir?" -ForegroundColor Cyan
Write-Host "  [1] talktoexpress"
Write-Host "  [2] taxmind"
Write-Host ""
$choice = Read-Host "Digite 1 ou 2"

switch ($choice) {
  "1" { Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\Administrador\dyad-apps\talktoexpress; opencode" }
  "2" { Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\Administrador\dyad-apps\taxmind; opencode" }
  default { Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\Administrador\dyad-apps\talktoexpress; opencode" }
}
