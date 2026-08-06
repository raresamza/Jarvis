#!/usr/bin/env python3

import argparse
import json
import os
import tempfile
import sys
from pathlib import Path
from typing import Any


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render Claude Code stream-json as readable activity output."
    )
    parser.add_argument(
        "--final-output",
        help="Optional path where the final result text is written atomically.",
    )
    return parser.parse_args()


def output(text: str, *, end: str = "\n") -> None:
    print(text, end=end, flush=True)


def write_final_output(file_path: str, text: str) -> None:
    destination = Path(file_path).expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)

    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
        text=True,
    )

    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(text.strip())
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())

        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


arguments = parse_arguments()
tool_names: dict[str, str] = {}
saw_text_delta = False

for raw_line in sys.stdin:
    line = raw_line.strip()

    if not line:
        continue

    try:
        message: dict[str, Any] = json.loads(line)
    except json.JSONDecodeError:
        output(raw_line, end="")
        continue

    message_type = message.get("type")

    if message_type == "system":
        subtype = message.get("subtype")

        if subtype == "init":
            session_id = message.get("session_id", "unknown")
            output(f"[STARTED] Session: {session_id}")

        elif subtype == "api_retry":
            attempt = message.get("attempt", "?")
            maximum = message.get("max_retries", "?")
            delay_ms = message.get("retry_delay_ms", 0)

            output(
                f"[RETRY] API attempt {attempt}/{maximum}, "
                f"waiting {delay_ms / 1000:.1f}s"
            )

    elif message_type == "stream_event":
        event = message.get("event", {})

        if event.get("type") != "content_block_delta":
            continue

        delta = event.get("delta", {})

        if delta.get("type") == "text_delta":
            text = delta.get("text", "")

            if text:
                saw_text_delta = True
                output(text, end="")

    elif message_type == "assistant":
        blocks = message.get("message", {}).get("content", [])

        for block in blocks:
            if block.get("type") != "tool_use":
                continue

            tool_name = str(block.get("name", "Unknown"))
            tool_id = str(block.get("id", ""))
            tool_input = block.get("input", {})

            if tool_id:
                tool_names[tool_id] = tool_name

            detail = (
                tool_input.get("file_path")
                or tool_input.get("path")
                or tool_input.get("pattern")
                or tool_input.get("command")
                or ""
            )

            detail = str(detail).replace("\n", " ")[:180]

            if detail:
                output(f"\n[TOOL] {tool_name}: {detail}")
            else:
                output(f"\n[TOOL] {tool_name}")

    elif message_type == "user":
        blocks = message.get("message", {}).get("content", [])

        for block in blocks:
            if block.get("type") != "tool_result":
                continue

            tool_id = str(block.get("tool_use_id", ""))
            tool_name = tool_names.get(tool_id, "Tool")

            if block.get("is_error", False):
                output(f"[TOOL ERROR] {tool_name}")
            else:
                output(f"[TOOL COMPLETE] {tool_name}")

    elif message_type == "result":
        result_text = message.get("result")

        if isinstance(result_text, str) and result_text.strip():
            if arguments.final_output:
                write_final_output(
                    arguments.final_output,
                    result_text,
                )

            if not saw_text_delta:
                output(result_text)

        subtype = message.get("subtype", "completed")
        is_error = message.get("is_error", False)

        if is_error:
            output(f"\n[FINISHED WITH ERROR] {subtype}")
        else:
            output(f"\n[FINISHED] {subtype}")
