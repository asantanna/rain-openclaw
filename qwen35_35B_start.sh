#!/bin/bash

# qwen35_35B_start.sh
# Starts the Qwen3.5-35B-A3B model via vLLM in Docker.
# The model serves an OpenAI-compatible API at http://127.0.0.1:8000/v1
#
# This is the OpenClaw test-local agent model.
# First run downloads model weights from HuggingFace (cached for next time).

set -e

CONTAINER_NAME="qwen35-35b"
IMAGE="vllm/vllm-openai:cu130-nightly"
MODEL="Qwen/Qwen3.5-35B-A3B"
SERVED_NAME="qwen3.5-35b-a3b"
MAX_MODEL_LEN=131072
GPU_MEM_UTIL=0.70

# Check if already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' is already running."
  echo "API: http://127.0.0.1:8000/v1"
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
    echo "Container started. API: http://127.0.0.1:8000/v1"
    echo "Use 'qwen35_35B_status.sh' to check when it's ready."
    exit 0
  fi
fi

echo "Creating and starting new container '${CONTAINER_NAME}'..."
echo "Model: ${MODEL}"
echo "Context: ${MAX_MODEL_LEN} tokens"
echo ""

mkdir -p ~/.cache/huggingface

docker run -d --name "${CONTAINER_NAME}" --gpus all --ipc=host \
  -p 127.0.0.1:8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  "${IMAGE}" \
    "${MODEL}" \
    --served-model-name "${SERVED_NAME}" \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEM_UTIL}" \
    --seed 42 \
    --trust-remote-code \
    --reasoning-parser qwen3 \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder

echo ""
echo "Container started. API: http://127.0.0.1:8000/v1"
echo "Use 'qwen35_35B_status.sh' to check when it's ready."
