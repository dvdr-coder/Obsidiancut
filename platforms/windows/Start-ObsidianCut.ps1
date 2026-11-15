$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

# Prepend bundled portable runtimes when packaged by GitHub Actions
$BundledNodeDir = Join-Path $RootDir 'runtime\node'
$BundledFfmpegBin = Join-Path $RootDir 'runtime\ffmpeg\bin'

if (Test-Path $BundledNodeDir) {
  $env:PATH = "$BundledNodeDir;$env:PATH"
}
if (Test-Path $BundledFfmpegBin) {
  $env:PATH = "$BundledFfmpegBin;$env:PATH"
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host '  Obsidian Cut - Multi-Track Video, Slideshow & Audio Studio' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host ''

# Verify Node.js
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
  Write-Host '[ERROR] Node.js was not found on PATH or in runtime\node.' -ForegroundColor Red
  Write-Host 'Install Node.js 22 LTS:  winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
  exit 1
}

# Verify Python 3
$PyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $PyCmd) {
  $PyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if (-not $PyLauncher) {
    Write-Host '[ERROR] Python 3.9+ is required for media probing and rendering.' -ForegroundColor Red
    Write-Host 'Install Python 3.12:  winget install Python.Python.3.12' -ForegroundColor Yellow
    exit 1
  }
}

# Verify FFmpeg
$FfmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $FfmpegCmd) {
  Write-Host '[WARN] FFmpeg was not found on PATH or in runtime\ffmpeg\bin.' -ForegroundColor Yellow
  Write-Host '       UI will open, but proxy/export jobs require FFmpeg:' -ForegroundColor Yellow
  Write-Host '       winget install Gyan.FFmpeg' -ForegroundColor Yellow
} else {
  Write-Host "[OK] FFmpeg: $($FfmpegCmd.Source)" -ForegroundColor Green
}

$ServerEntry = Join-Path $RootDir 'dist-server\server.mjs'
if (-not (Test-Path $ServerEntry)) {
  Write-Host '[ERROR] dist-server\server.mjs is missing from this package.' -ForegroundColor Red
  exit 1
}

$env:NODE_ENV = 'production'
$Port = 3000
$AppUrl = "http://127.0.0.1:$Port"

Write-Host "[INFO] Starting Obsidian Cut server at $AppUrl ..." -ForegroundColor Gray
$Proc = Start-Process -FilePath $NodeCmd.Source -ArgumentList @($ServerEntry, '--prod') -WorkingDirectory $RootDir -PassThru -NoNewWindow

try {
  $Ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    if ($Proc.HasExited) {
      throw "Server process exited early with code $($Proc.ExitCode)."
    }
    try {
      $Resp = Invoke-RestMethod -Uri "$AppUrl/api/health" -TimeoutSec 2 -ErrorAction Stop
      if ($Resp.ok -eq $true) {
        $Ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 350
    }
  }

  if (-not $Ready) {
    Write-Host '[WARN] Health probe timed out; opening app window anyway...' -ForegroundColor Yellow
  } else {
    Write-Host '[OK] Obsidian Cut Studio backend & Python FFmpeg engine ready.' -ForegroundColor Green
  }

  # Prefer Edge or Chrome in desktop --app mode (no browser tabs/chrome)
  $AppBrowserCandidates = @(
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($AppBrowserCandidates.Count -gt 0) {
    $BrowserExe = $AppBrowserCandidates[0]
    Write-Host "[INFO] Launching desktop window via $(Split-Path -Leaf $BrowserExe)" -ForegroundColor Cyan
    Start-Process -FilePath $BrowserExe -ArgumentList @("--app=$AppUrl", '--window-size=1440,900')
  } else {
    Write-Host "[INFO] Opening default browser at $AppUrl" -ForegroundColor Cyan
    Start-Process $AppUrl
  }

  Write-Host ''
  Write-Host "Obsidian Cut is running at $AppUrl" -ForegroundColor White
  Write-Host 'Keep this window open while editing or rendering. Press Ctrl+C to stop.' -ForegroundColor DarkGray
  Write-Host ''

  Wait-Process -Id $Proc.Id
} finally {
  if ($Proc -and -not $Proc.HasExited) {
    Write-Host '[INFO] Shutting down Obsidian Cut server...' -ForegroundColor Gray
    Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
  }
}
