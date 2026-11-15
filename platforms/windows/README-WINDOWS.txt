OBSIDIAN CUT - WINDOWS x64 DESKTOP PACKAGE
===========================================

Quick Start:
1. Extract this entire ZIP folder anywhere (for example: C:\Apps\ObsidianCut\).
2. Double-click "Start-ObsidianCut.bat".
   - Microsoft Edge / Chrome will open Obsidian Cut in a standalone desktop window
     at http://127.0.0.1:3000.
   - Keep the terminal window open while editing and exporting videos.

Bundled / Required Runtimes:
- Node.js 22 portable executable is bundled in runtime\node\ (when built via CI).
- FFmpeg & FFprobe essentials are bundled in runtime\ffmpeg\bin\ (when built via CI).
- Python 3.9+ is required on your PC (standard library only, zero pip packages):
  If Python is not installed yet, run in PowerShell:
    winget install Python.Python.3.12

Data & Exports Folder:
- Uploaded media, edit proxies, and rendered MP4/MOV/WebM files are saved locally in:
  .obsidiancut_data\
  (Override location by setting environment variable OBSIDIANCUT_DATA_DIR.)
