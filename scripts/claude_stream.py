#!/usr/bin/env python3

import json
import sys
from typing import Any


tool_names: dict[str, str] = {}
saw_text_delta = False


def output(text: str, *, end: str = "\n") -> None:
    print(text, end=end, flush=True)


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

        if (
            not saw_text_delta
            and isinstance(result_text, str)
            and result_text.strip()
        ):
            output(result_text)

        subtype = message.get("subtype", "completed")
        is_error = message.get("is_error", False)

        if is_error:
            output(f"\n[FINISHED WITH ERROR] {subtype}")
        else:
            output(f"\n[FINISHED] {subtype}")
