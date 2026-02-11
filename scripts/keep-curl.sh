#!/usr/bin/env bash
set -euo pipefail
: "${KEEP_X_API_KEY:=local-dev}"
curl -H "x-api-key: ${KEEP_X_API_KEY}" "$@"
