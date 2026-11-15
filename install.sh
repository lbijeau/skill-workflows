#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="$(node -v 2>/dev/null)" || { echo "Error: Node.js >= 18 is required but node was not found on PATH." >&2; exit 1; }
NODE_MAJOR="$(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node $NODE_VERSION found, but Node >= 18 is required." >&2
  exit 1
fi

exec node "$(cd "$(dirname "$0")" && pwd)/scripts/install.mjs" "$@"
