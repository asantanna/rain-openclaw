#!/bin/bash

# qwen_stop.sh
# Stops the Qwen3 vLLM container. Does NOT remove it.
# Use qwen_start.sh to restart (faster — skips container creation).
# Use --rm to stop AND remove the container.

set -e

CONTAINER_NAME="qwen3-vllm"
REMOVE=false

if [ "$1" = "--rm" ]; then
  REMOVE=true
fi

if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' does not exist. Nothing to stop."
  exit 0
fi

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping '${CONTAINER_NAME}'..."
  docker stop "${CONTAINER_NAME}"
  echo "Stopped."
else
  echo "Container '${CONTAINER_NAME}' is already stopped."
fi

if [ "$REMOVE" = true ]; then
  echo "Removing container..."
  docker rm "${CONTAINER_NAME}"
  echo "Removed. Next start will create a fresh container."
fi
