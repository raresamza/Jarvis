#!/usr/bin/env bash
set -euo pipefail

VENV_DIR="${JARVIS_TTS_VENV:-$HOME/.local/share/jarvis/venvs/tts}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python was not found: $PYTHON_BIN" >&2
  exit 1
fi

if [[ "${JARVIS_TTS_RECREATE:-0}" == "1" ]]; then
  rm -rf "$VENV_DIR"
fi

"$PYTHON_BIN" -m venv "$VENV_DIR"

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

PYTHON_MAJOR="$($PYTHON -c 'import sys; print(sys.version_info.major)')"
PYTHON_MINOR="$($PYTHON -c 'import sys; print(sys.version_info.minor)')"
PYTHON_VERSION="$($PYTHON -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"

if [[ "$PYTHON_MAJOR" -ne 3 || "$PYTHON_MINOR" -lt 10 ]]; then
  echo "Chatterbox requires Python 3.10 or newer; found Python $PYTHON_VERSION" >&2
  exit 1
fi

# Chatterbox 0.1.7 uses different dependency ranges for Python 3.14+.
# Python 3.14 has no PyTorch 2.7.1 wheel, so use the first stable CUDA 12.8
# release line that officially provides CPython 3.14 wheels.
if (( PYTHON_MINOR >= 14 )); then
  TORCH_VERSION="${JARVIS_TTS_TORCH_VERSION:-2.9.1}"
  NUMPY_SPEC="numpy>=2.0.0"
else
  # PyTorch 2.7.1 CUDA 12.8 supports Blackwell GPUs on Python 3.10-3.13.
  TORCH_VERSION="${JARVIS_TTS_TORCH_VERSION:-2.7.1}"
  NUMPY_SPEC="numpy>=1.24.0,<2.0.0"
fi

"$PIP" install --upgrade pip setuptools wheel

printf 'Configuring Jarvis TTS with Python %s, PyTorch %s, CUDA 12.8\n' \
  "$PYTHON_VERSION" \
  "$TORCH_VERSION"

"$PIP" install \
  "torch==$TORCH_VERSION" \
  "torchaudio==$TORCH_VERSION" \
  --index-url https://download.pytorch.org/whl/cu128

# Install Chatterbox runtime dependencies without allowing its strict torch
# dependency to replace the Blackwell-ready CUDA build installed above.
# Gradio is intentionally omitted because Jarvis provides its own HTTP/UI layer.
"$PIP" install \
  "$NUMPY_SPEC" \
  librosa==0.11.0 \
  s3tokenizer \
  transformers==5.2.0 \
  diffusers==0.29.0 \
  conformer==0.3.2 \
  safetensors==0.5.3 \
  spacy-pkuseg \
  pykakasi==2.3.0 \
  pyloudnorm \
  omegaconf \
  'resemble-perth @ git+https://github.com/resemble-ai/Perth.git@master'

"$PIP" install chatterbox-tts==0.1.7 --no-deps

"$PYTHON" - <<'PY'
import sys
import torch
import torchaudio
import chatterbox

print("Jarvis TTS environment ready")
print(f"Python: {sys.version.split()[0]}")
print(f"PyTorch: {torch.__version__}")
print(f"TorchAudio: {torchaudio.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")

if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"Compute capability: {torch.cuda.get_device_capability(0)}")
else:
    raise SystemExit(
        "PyTorch installed, but CUDA is unavailable. Check the Windows NVIDIA "
        "driver and WSL GPU access before starting Jarvis TTS."
    )
PY

cat <<EOF

Start the service from the Jarvis repository with:
  bin/jarvis-tts --preload

Python environment:
  $VENV_DIR
EOF
