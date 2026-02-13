#!/bin/bash

# qwen_start.sh
# Starts the Qwen3-30B-A3B-Instruct model via vLLM in Docker.
# The model serves an OpenAI-compatible API at http://127.0.0.1:8000/v1
#
# First run downloads ~20GB of model weights from HuggingFace (cached for next time).
# Startup takes ~15-20 minutes (download + load + CUDA graph compilation).
# Subsequent starts take ~5-10 minutes (load + compile, no download).
#
# See: rain-docs/local_llm_install_v2.md

set -e

CONTAINER_NAME="qwen3-vllm"
IMAGE="nvcr.io/nvidia/vllm:26.01-py3"
MODEL="Qwen/Qwen3-30B-A3B-Instruct-2507"
SERVED_NAME="qwen3-30b-a3b-instruct"
MAX_MODEL_LEN=131072
GPU_MEM_UTIL=0.85

# Check if already running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Container '${CONTAINER_NAME}' is already running."
  echo "Use qwen_status.sh to check, or qwen_stop.sh to stop it first."
  exit 0
fi

# Check if container exists but is stopped
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Starting existing container '${CONTAINER_NAME}'..."
  docker start "${CONTAINER_NAME}"
else
  echo "Creating and starting new container '${CONTAINER_NAME}'..."
  echo "Model: ${MODEL}"
  echo "Context: ${MAX_MODEL_LEN} tokens"
  echo ""

  # Ensure HuggingFace cache exists
  mkdir -p ~/.cache/huggingface

  docker run -d --name "${CONTAINER_NAME}" --gpus all --ipc=host \
    -p 127.0.0.1:8000:8000 \
    -v ~/.cache/huggingface:/root/.cache/huggingface \
    "${IMAGE}" \
    python -m vllm.entrypoints.openai.api_server \
      --model "${MODEL}" \
      --served-model-name "${SERVED_NAME}" \
      --max-model-len "${MAX_MODEL_LEN}" \
      --gpu-memory-utilization "${GPU_MEM_UTIL}" \
      --trust-remote-code \
      --enable-auto-tool-choice \
      --tool-call-parser hermes
fi

echo ""
echo "Container started. The model takes a few minutes to load."
echo "Use 'qwen_status.sh' to check when it's ready."
echo "Use 'qwen_logs.sh' to watch the startup progress."
