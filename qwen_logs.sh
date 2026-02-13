#!/bin/bash

# qwen_logs.sh
# Follows the Qwen3 vLLM container logs.
# Press Ctrl+C to stop following.
# Use --tail N to show last N lines (default: 50).

CONTAINER_NAME="qwen3-vllm"
TAIL="${1:-50}"

if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' does not exist."
  exit 1
fi

docker logs --tail "${TAIL}" -f "${CONTAINER_NAME}"
