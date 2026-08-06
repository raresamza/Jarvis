#!/usr/bin/env python3
"""Persistent local Chatterbox TTS HTTP service for Jarvis."""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import threading
import traceback
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_TEXT_LENGTH = 6_000


def env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default

    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number, received {raw!r}") from exc


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default

    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, received {raw!r}") from exc


def add_terminal_punctuation(value: str) -> str:
    value = value.strip()
    if not value:
        return ""

    if value.endswith((".", "!", "?")):
        return value

    return f"{value}."


def split_oversized_piece(piece: str, max_chars: int) -> list[str]:
    words = piece.split()
    chunks: list[str] = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(add_terminal_punctuation(current))

        if len(word) <= max_chars:
            current = word
            continue

        chunks.extend(
            add_terminal_punctuation(word[index : index + max_chars])
            for index in range(0, len(word), max_chars)
        )
        current = ""

    if current:
        chunks.append(add_terminal_punctuation(current))

    return chunks


def split_text(text: str, max_chars: int) -> list[str]:
    pieces = re.findall(r"[^.!?\n]+(?:[.!?]+|$)", text)
    if not pieces:
        pieces = [text]

    chunks: list[str] = []
    current = ""

    for raw_piece in pieces:
        piece = " ".join(raw_piece.split()).strip()
        if not piece:
            continue

        if len(piece) > max_chars:
            if current:
                chunks.append(current)
                current = ""

            chunks.extend(split_oversized_piece(piece, max_chars))
            continue

        candidate = f"{current} {piece}".strip()
        if len(candidate) <= max_chars:
            current = candidate
            continue

        chunks.append(current)
        current = piece

    if current:
        chunks.append(current)

    return chunks


class TTSRuntime:
    def __init__(self) -> None:
        self.model_kind = os.environ.get("JARVIS_TTS_MODEL", "standard").strip().lower()
        if self.model_kind not in {"standard", "turbo"}:
            raise RuntimeError("JARVIS_TTS_MODEL must be either 'standard' or 'turbo'")

        self.requested_device = os.environ.get("JARVIS_TTS_DEVICE", "auto").strip().lower()
        self.reference_path = os.environ.get("JARVIS_TTS_REFERENCE", "").strip()
        self.pitch_steps = env_float("JARVIS_TTS_PITCH_STEPS", -1.0)
        self.exaggeration = env_float("JARVIS_TTS_EXAGGERATION", 0.35)
        self.cfg_weight = env_float("JARVIS_TTS_CFG_WEIGHT", 0.35)
        self.temperature = env_float("JARVIS_TTS_TEMPERATURE", 0.6)
        self.repetition_penalty = env_float(
            "JARVIS_TTS_REPETITION_PENALTY", 1.25
        )
        self.top_p = env_float("JARVIS_TTS_TOP_P", 0.9)
        self.top_k = env_int("JARVIS_TTS_TOP_K", 100)
        self.max_chunk_chars = env_int("JARVIS_TTS_MAX_CHUNK_CHARS", 240)
        self.pause_ms = env_int("JARVIS_TTS_PAUSE_MS", 140)
        self.seed = env_int("JARVIS_TTS_SEED", 42)
        self.log_text = os.environ.get("JARVIS_TTS_LOG_TEXT", "1") != "0"

        if self.max_chunk_chars < 80 or self.max_chunk_chars > 500:
            raise RuntimeError("JARVIS_TTS_MAX_CHUNK_CHARS must be between 80 and 500")

        if self.pause_ms < 0 or self.pause_ms > 2_000:
            raise RuntimeError("JARVIS_TTS_PAUSE_MS must be between 0 and 2000")

        self._model: Any | None = None
        self._torch: Any | None = None
        self._torchaudio: Any | None = None
        self._device = "unresolved"
        self._reference_prepared = False
        self._load_lock = threading.Lock()
        self._generation_lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    @property
    def device(self) -> str:
        return self._device

    def _resolve_reference_path(self) -> str | None:
        if not self.reference_path:
            return None

        path = Path(self.reference_path).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"TTS reference audio was not found: {path}")

        return str(path)

    def _resolve_device(self, torch: Any) -> str:
        if self.requested_device == "auto":
            return "cuda" if torch.cuda.is_available() else "cpu"

        if self.requested_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError(
                "JARVIS_TTS_DEVICE is set to cuda, but PyTorch cannot access CUDA"
            )

        if self.requested_device not in {"cuda", "cpu"}:
            raise RuntimeError("JARVIS_TTS_DEVICE must be auto, cuda, or cpu")

        return self.requested_device

    def load(self) -> None:
        if self._model is not None:
            return

        with self._load_lock:
            if self._model is not None:
                return

            import torch
            import torchaudio

            device = self._resolve_device(torch)
            reference_path = self._resolve_reference_path()

            if self.model_kind == "turbo":
                if reference_path is None:
                    raise RuntimeError(
                        "Chatterbox Turbo requires JARVIS_TTS_REFERENCE to point to a WAV file"
                    )

                from chatterbox.tts_turbo import ChatterboxTurboTTS

                model = ChatterboxTurboTTS.from_pretrained(device=device)
                model.prepare_conditionals(reference_path)
                reference_prepared = True
            else:
                from chatterbox.tts import ChatterboxTTS

                model = ChatterboxTTS.from_pretrained(device=device)
                reference_prepared = False
                if reference_path is not None:
                    model.prepare_conditionals(
                        reference_path,
                        exaggeration=self.exaggeration,
                    )
                    reference_prepared = True

            self._torch = torch
            self._torchaudio = torchaudio
            self._device = device
            self._model = model
            self._reference_prepared = reference_prepared

            print(
                "Jarvis TTS model loaded "
                f"(model={self.model_kind}, device={device}, "
                f"reference={'cached' if reference_prepared else 'built-in voice'})",
                flush=True,
            )

    def describe(self) -> dict[str, Any]:
        reference = self._resolve_reference_path()
        return {
            "ok": True,
            "model": self.model_kind,
            "device": self.device,
            "loaded": self.loaded,
            "referenceConfigured": reference is not None,
            "referenceCached": self._reference_prepared,
            "pitchSteps": self.pitch_steps,
            "temperature": self.temperature,
            "repetitionPenalty": self.repetition_penalty,
            "topP": self.top_p,
            "topK": self.top_k,
            "maxChunkChars": self.max_chunk_chars,
        }

    def _generate_chunk(self, text: str, chunk_index: int) -> Any:
        assert self._model is not None
        assert self._torch is not None

        if self.seed >= 0:
            seed = self.seed + chunk_index
            self._torch.manual_seed(seed)
            if self.device == "cuda":
                self._torch.cuda.manual_seed_all(seed)

        if self.model_kind == "turbo":
            return self._model.generate(
                text,
                temperature=self.temperature,
                repetition_penalty=self.repetition_penalty,
                top_p=self.top_p,
                top_k=self.top_k,
            )

        return self._model.generate(
            text,
            exaggeration=self.exaggeration,
            cfg_weight=self.cfg_weight,
            temperature=self.temperature,
            repetition_penalty=self.repetition_penalty,
            top_p=self.top_p,
        )

    def synthesize(self, text: str) -> tuple[bytes, int]:
        normalized = " ".join(text.split()).strip()
        if not normalized:
            raise ValueError("Text is required")

        if len(normalized) > MAX_TEXT_LENGTH:
            raise ValueError(f"Text must not exceed {MAX_TEXT_LENGTH} characters")

        self.load()
        assert self._model is not None
        assert self._torch is not None
        assert self._torchaudio is not None

        chunks = split_text(normalized, self.max_chunk_chars)
        if not chunks:
            raise ValueError("Text did not contain anything speakable")

        if self.log_text:
            print(
                f"Jarvis TTS input: {len(normalized)} chars, {len(chunks)} chunk(s)",
                flush=True,
            )
            for index, chunk in enumerate(chunks, start=1):
                print(f"  [{index}/{len(chunks)}] {chunk}", flush=True)

        with self._generation_lock:
            sample_rate = int(self._model.sr)
            generated_parts: list[Any] = []

            for index, chunk in enumerate(chunks):
                wav = self._generate_chunk(chunk, index)
                wav = wav.detach().float().cpu()
                if wav.ndim == 1:
                    wav = wav.unsqueeze(0)

                generated_parts.append(wav)

                if index < len(chunks) - 1 and self.pause_ms > 0:
                    silence_samples = int(sample_rate * self.pause_ms / 1_000)
                    generated_parts.append(
                        self._torch.zeros((1, silence_samples), dtype=wav.dtype)
                    )

            wav = self._torch.cat(generated_parts, dim=1)

            if abs(self.pitch_steps) >= 0.01:
                wav = self._torchaudio.functional.pitch_shift(
                    wav,
                    sample_rate,
                    self.pitch_steps,
                )

            peak = float(wav.abs().max().item()) if wav.numel() else 0.0
            if peak > 0:
                wav = wav * (0.95 / peak)

            pcm = (
                wav.squeeze(0)
                .clamp(-1.0, 1.0)
                .mul(32767.0)
                .round()
                .to(self._torch.int16)
                .numpy()
                .tobytes()
            )

        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm)

        return output.getvalue(), sample_rate


RUNTIME = TTSRuntime()


class JarvisTTSHandler(BaseHTTPRequestHandler):
    server_version = "JarvisTTS/1.1"

    def log_message(self, format_string: str, *args: object) -> None:
        print(
            f"{self.client_address[0]} - {format_string % args}",
            flush=True,
        )

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            self._send_json(HTTPStatus.OK, RUNTIME.describe())
        except Exception as error:  # pragma: no cover - service boundary
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"ok": False, "error": str(error)},
            )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/synthesize":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 64_000:
                raise ValueError("Invalid request body size")

            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
            text = payload.get("text")

            if not isinstance(text, str):
                raise ValueError("text must be a string")

            audio, sample_rate = RUNTIME.synthesize(text)

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Jarvis-TTS-Model", RUNTIME.model_kind)
            self.send_header("X-Jarvis-TTS-Device", RUNTIME.device)
            self.send_header("X-Jarvis-TTS-Sample-Rate", str(sample_rate))
            self.end_headers()
            self.wfile.write(audio)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # pragma: no cover - service boundary
            traceback.print_exc()
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": str(error)},
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Jarvis TTS service")
    parser.add_argument(
        "--host",
        default=os.environ.get("JARVIS_TTS_HOST", "127.0.0.1"),
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("JARVIS_TTS_PORT", "8765")),
    )
    parser.add_argument(
        "--preload",
        action="store_true",
        help="Load the model before accepting requests",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.preload:
        RUNTIME.load()

    server = ThreadingHTTPServer((args.host, args.port), JarvisTTSHandler)
    print(
        f"Jarvis TTS listening on http://{args.host}:{args.port} "
        f"(model={RUNTIME.model_kind})",
        flush=True,
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Jarvis TTS", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
