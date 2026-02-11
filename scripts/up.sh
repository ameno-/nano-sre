#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d --build keep-websocket-server keep-backend keep-frontend nano-sre-harness
