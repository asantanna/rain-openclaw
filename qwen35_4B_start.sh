#!/bin/bash

# qwen35_4B_start.sh
# Starts the Qwen3.5-4B model via vLLM in Docker for fast control-loop inference.
# The model serves an OpenAI-compatible API at http://127.0.0.1:8001/v1
#
# This is a small, fast model for direct Python API calls — NOT an OpenClaw agent.
# Thinking mode should be disabled at the API call level for minimal latency.
# Prefix caching is enabled by default in vLLM.
#
# Can run simultaneously with the 35B on port 8000.

set -e

CONTAINER_NAME="qwen35-4b"
IMAGE="vllm/vllm-openai:cu130-nightly"
MODEL="Qwen/Qwen3.5-4B"
SERVED_NAME="qwen3.5-4b"
MAX_MODEL_LEN=32768
GPU_MEM_UTIL=0.25

# Check if already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' is already running."
  echo "API: http://127.0.0.1:8001/v1"
  exit 0
fi

# Check if container exists but is stopped — remove it if image/model changed
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  EXISTING_IMAGE=$(docker inspect --format='{{.Config.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)
  if [ "${EXISTING_IMAGE}" != "${IMAGE}" ]; then
    echo "Container exists with different image (${EXISTING_IMAGE})."
    echo "Removing old container to recreate with new image..."
    docker rm "${CONTAINER_NAME}"
  else
    echo "Starting existing container '${CONTAINER_NAME}'..."
    docker start "${CONTAINER_NAME}"
    echo ""
    echo "Container started. API: http://127.0.0.1:8001/v1"
    exit 0
  fi
fi

echo "Creating and starting new container '${CONTAINER_NAME}'..."
echo "Model: ${MODEL}"
echo "Context: ${MAX_MODEL_LEN} tokens"
echo ""

mkdir -p ~/.cache/huggingface

docker run -d --name "${CONTAINER_NAME}" --gpus all --ipc=host \
  -p 127.0.0.1:8001:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  "${IMAGE}" \
    "${MODEL}" \
    --served-model-name "${SERVED_NAME}" \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEM_UTIL}" \
    --seed 42 \
    --trust-remote-code

echo ""
echo "Container started. API: http://127.0.0.1:8001/v1"
echo "Model: ${SERVED_NAME} (disable thinking at API call level)"
