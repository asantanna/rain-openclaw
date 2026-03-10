#!/bin/bash
# qwen35_4B_status.sh — Check the Qwen3.5-4B fast model status
CONTAINER_NAME="qwen35-4b"
API_URL="http://127.0.0.1:8001/v1"

echo "=== Container Status ==="
docker ps -a --filter name="${CONTAINER_NAME}" --format 'Name: {{.Names}}\nStatus: {{.Status}}\nImage: {{.Image}}'

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ""
  echo "=== API Health ==="
  if curl -sf "${API_URL}/models" > /dev/null 2>&1; then
    echo "API: READY"
    curl -sf "${API_URL}/models" | python3 -m json.tool 2>/dev/null || true
  else
    echo "API: NOT READY (still loading)"
  fi
fi
