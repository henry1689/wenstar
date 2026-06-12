# Taixujing Data Backup Script
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$source = "C:\Users\Administrator\wenstar\data"
$backupRoot = "C:\Users\Administrator\wenstar\backups"
$backupDir = "$backupRoot\$timestamp"

$coreFiles = @(
    "webui\conversations.json",
    "webui\fusion_memory.db",
    "webui\knowledge\family_graph.db",
    "self_model.json"
)

Write-Host "=== Taixujing Backup ===" -ForegroundColor Cyan
Write-Host "Time: $timestamp"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$ok = 0
$skip = 0

foreach ($file in $coreFiles) {
    $srcPath = Join-Path $source $file
    $relDir = Split-Path $file -Parent
    $dstDir = Join-Path $backupDir $relDir
    New-Item -ItemType Directory -Path $dstDir -Force | Out-Null

    if (Test-Path $srcPath) {
        Copy-Item $srcPath (Join-Path $backupDir $file) -Force
        Write-Host "  [OK] $file" -ForegroundColor Green
        $ok++
    } else {
        Write-Host "  [SKIP] $file (not found)" -ForegroundColor Yellow
        $skip++
    }
}

# Clean backups older than 30 days
$oldBackups = Get-ChildItem $backupRoot -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-30) }
foreach ($old in $oldBackups) {
    Remove-Item $old.FullName -Recurse -Force
    Write-Host "  [CLEAN] expired: $($old.Name)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done: $ok files backed up, $skip skipped" -ForegroundColor Green
Write-Host "Location: $backupDir" -ForegroundColor Cyan
if ($oldBackups.Count -gt 0) { Write-Host "Cleaned $($oldBackups.Count) old backups" -ForegroundColor DarkGray }
