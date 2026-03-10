#!/bin/bash
# qwen35_35B_status.sh — Check the Qwen3.5-35B-A3B status
CONTAINER_NAME="qwen35-35b"
API_URL="http://127.0.0.1:8000/v1"

echo "=== Container Status ==="
docker ps -a --filter name="${CONTAINER_NAME}" --format 'Name: {{.Names}}\nStatus: {{.Status}}\nImage: {{.Image}}'

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ""
  echo "=== Resource Usage ==="
  docker stats --no-stream --format 'CPU: {{.CPUPerc}}  Mem: {{.MemUsage}}' "${CONTAINER_NAME}" 2>/dev/null || true
  echo ""
  echo "=== GPU Memory ==="
  nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null || true
  echo ""
  echo "=== API Health ==="
  if curl -sf "${API_URL}/models" > /dev/null 2>&1; then
    echo "API: READY"
    curl -sf "${API_URL}/models" | python3 -m json.tool 2>/dev/null || true
  else
    echo "API: NOT READY (still loading)"
  fi
else
  echo ""
  echo "Container is stopped. Run qwen35_35B_start.sh to start it."
fi
