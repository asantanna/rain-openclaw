#!/bin/bash

# qwen35_35B_start_minimal.sh
# Starts the Qwen3.5-35B-A3B model in minimal/fast mode — no thinking,
# no tool calling, no reasoning parser. Bare-bones for direct API use.
# The model serves an OpenAI-compatible API at http://127.0.0.1:8000/v1
#
# Use this instead of qwen35_35B_start.sh when you want the 35B as a
# fast inference engine (like the 4B) rather than an OpenClaw agent.

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
  echo "Use qwen35_35B_stop.sh first if you want to switch modes."
  exit 0
fi

# Check if container exists but is stopped — remove to recreate with new flags
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Removing existing container to recreate in minimal mode..."
  docker rm "${CONTAINER_NAME}"
fi

echo "Creating and starting container '${CONTAINER_NAME}' (MINIMAL mode)..."
echo "Model: ${MODEL}"
echo "Context: ${MAX_MODEL_LEN} tokens"
echo "Mode: no thinking, no tool calling, no reasoning parser"
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
    --trust-remote-code

echo ""
echo "Container started (MINIMAL mode). API: http://127.0.0.1:8000/v1"
echo "Disable thinking at API level: chat_template_kwargs={\"enable_thinking\": false}"
echo "Use 'qwen35_35B_status.sh' to check when it's ready."
