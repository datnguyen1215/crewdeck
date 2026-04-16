#!/usr/bin/env bash
# Start Ollama + LiteLLM proxy for Qwen 3.5 9B (128K context, no thinking)

set -euo pipefail

OLLAMA_MODEL="qwen3.5:9b-128k"
LITELLM_PORT=4000
CONFIG_FILE="/tmp/litellm-config.yaml"

# Start Ollama if not running
if ! pgrep -x ollama > /dev/null; then
  echo "Starting Ollama..."
  ollama serve &
  sleep 3
fi

# Create the 128K model if it doesn't exist
if ! ollama list | grep -q "$OLLAMA_MODEL"; then
  echo "Creating $OLLAMA_MODEL..."
  cat > /tmp/qwen-modelfile <<'EOF'
FROM qwen3.5:9b
PARAMETER num_ctx 131072
EOF
  ollama create "$OLLAMA_MODEL" -f /tmp/qwen-modelfile
  rm /tmp/qwen-modelfile
fi

# Write LiteLLM config (think: false disables thinking mode)
cat > "$CONFIG_FILE" <<EOF
model_list:
  - model_name: qwen-3.5-9b
    litellm_params:
      model: ollama/$OLLAMA_MODEL
      api_base: http://localhost:11434
      think: false
EOF

# Kill existing LiteLLM if running
pkill litellm 2>/dev/null || true
sleep 1

echo "Starting LiteLLM proxy on port $LITELLM_PORT..."
litellm --config "$CONFIG_FILE" --port "$LITELLM_PORT" --drop_params
