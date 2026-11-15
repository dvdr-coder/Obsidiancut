#!/usr/bin/env bash
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --legacy-peer-deps
fi

echo "Starting Obsidian Cut → http://localhost:3000"
npm run dev
