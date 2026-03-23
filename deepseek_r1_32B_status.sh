#!/bin/bash
# deepseek_r1_32B_status.sh — Check DeepSeek-R1-Distill-Qwen-32B container status

CONTAINER_NAME="deepseek-r1-32b"

echo "=== Container Status ==="
docker ps -a --filter "name=^${CONTAINER_NAME}$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ""
  echo "=== Resource Usage ==="
  docker stats --no-stream "${CONTAINER_NAME}" --format "CPU: {{.CPUPerc}}  Mem: {{.MemUsage}}"

  echo ""
  echo "=== GPU Memory ==="
  nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "nvidia-smi not available"

  echo ""
  echo "=== API Health ==="
  curl -s http://127.0.0.1:8000/v1/models 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "API not ready yet (model still loading)"
else
  echo ""
  echo "Container is not running."
fi
