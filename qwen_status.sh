#!/bin/bash

# qwen_status.sh
# Shows the status of the Qwen3 vLLM container and API endpoint.

CONTAINER_NAME="qwen3-vllm"

echo "=== Container ==="

if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' does not exist."
  echo "Run qwen_start.sh to create and start it."
  exit 0
fi

docker ps -a --filter "name=^${CONTAINER_NAME}$" --format "Name: {{.Names}}\nStatus: {{.Status}}\nImage: {{.Image}}"
echo ""

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "=== Resources ==="
  docker stats "${CONTAINER_NAME}" --no-stream --format "CPU: {{.CPUPerc}}, Memory: {{.MemUsage}}"
  echo ""

  echo "=== GPU ==="
  nvidia-smi --query-compute-apps=pid,name,used_gpu_memory --format=csv,noheader 2>/dev/null || echo "(nvidia-smi not available)"
  echo ""

  echo "=== API Endpoint ==="
  if curl -sf http://127.0.0.1:8000/v1/models > /dev/null 2>&1; then
    echo "API: READY at http://127.0.0.1:8000/v1"
    MODEL_ID=$(curl -sf http://127.0.0.1:8000/v1/models | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
    echo "Model: ${MODEL_ID:-unknown}"
  else
    echo "API: NOT READY (model still loading — check qwen_logs.sh)"
  fi
else
  echo "Container is stopped. Run qwen_start.sh to start it."
fi
