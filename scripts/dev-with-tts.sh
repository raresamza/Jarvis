#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  echo
  echo "Stopping Jarvis services..."
  kill "$TTS_PID" "$NEXT_PID" 2>/dev/null || true
  wait "$TTS_PID" "$NEXT_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting Jarvis TTS..."
bin/jarvis-tts --preload &
TTS_PID=$!

echo "Waiting for TTS server..."
for _ in {1..120}; do
  if curl --silent --fail http://127.0.0.1:8765/health >/dev/null; then
    echo "TTS server is ready."
    break
  fi

  if ! kill -0 "$TTS_PID" 2>/dev/null; then
    echo "TTS server failed to start."
    exit 1
  fi

  sleep 1
done

if ! curl --silent --fail http://127.0.0.1:8765/health >/dev/null; then
  echo "Timed out waiting for TTS server."
  exit 1
fi

echo "Starting Next.js..."
npm run dev &
NEXT_PID=$!

wait -n "$TTS_PID" "$NEXT_PID"
