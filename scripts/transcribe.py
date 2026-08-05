#!/usr/bin/env python3

import json
import os
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps({"error": "Expected an audio file path."}),
            file=sys.stderr,
        )
        return 2

    audio_path = Path(sys.argv[1]).resolve()

    if not audio_path.is_file():
        print(
            json.dumps({"error": f"Audio file not found: {audio_path}"}),
            file=sys.stderr,
        )
        return 2

    model_name = os.environ.get("JARVIS_WHISPER_MODEL", "small")
    device = os.environ.get("JARVIS_WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get(
        "JARVIS_WHISPER_COMPUTE_TYPE",
        "int8",
    )

    language_value = os.environ.get(
        "JARVIS_WHISPER_LANGUAGE",
        "",
    ).strip()

    language = language_value or None

    cpu_threads = int(
        os.environ.get("JARVIS_WHISPER_CPU_THREADS", "12")
    )

    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        cpu_threads=cpu_threads,
        num_workers=1,
    )

    segments, info = model.transcribe(
        str(audio_path),
        beam_size=5,
        language=language,
        task="transcribe",
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 400,
        },
        condition_on_previous_text=False,
        word_timestamps=False,
    )

    text_parts: list[str] = []

    for segment in segments:
        segment_text = segment.text.strip()

        if segment_text:
            text_parts.append(segment_text)

    text = " ".join(text_parts).strip()

    print(
        json.dumps(
            {
                "text": text,
                "language": info.language,
                "languageProbability": info.language_probability,
                "duration": info.duration,
            },
            ensure_ascii=False,
        )
    )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {
                    "error": str(error),
                    "type": type(error).__name__,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
