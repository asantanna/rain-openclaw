#!/bin/bash
# qwen35_35B_stop.sh — Stop the Qwen3.5-35B-A3B container
set -e
CONTAINER_NAME="qwen35-35b"
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Stopping '${CONTAINER_NAME}'..."
  docker stop "${CONTAINER_NAME}"
  echo "Stopped."
else
  echo "Container '${CONTAINER_NAME}' is not running."
fi
