#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$ROOT/vendor"
NANOBOT_DIR="$VENDOR_DIR/nanobot"

mkdir -p "$VENDOR_DIR" "$ROOT/nanobot/workspace" "$ROOT/state"

if [ ! -d "$NANOBOT_DIR/.git" ]; then
  git clone https://github.com/HKUDS/nanobot "$NANOBOT_DIR"
else
  echo "vendor/nanobot already exists; skipping clone"
fi

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example"
fi

if [ ! -f "$ROOT/nanobot/config.json" ]; then
  cp "$ROOT/nanobot/config.example.json" "$ROOT/nanobot/config.json"
  echo "Created nanobot/config.json from config.example.json"
fi

echo "Bootstrap complete. Edit .env and nanobot/config.json before running up.sh"
