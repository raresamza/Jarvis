import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TTS_URL = "http://127.0.0.1:8765";
const MAX_TEXT_LENGTH = 6_000;
const REQUEST_TIMEOUT_MS = 180_000;

interface TTSRequestBody {
  text?: unknown;
}

function getTTSBaseUrl(): string {
  return (
    process.env.JARVIS_TTS_URL ??
    DEFAULT_TTS_URL
  ).replace(/\/+$/, "");
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readServiceError(
  response: Response,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: unknown;
    };

    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // The service may have returned a non-JSON error.
  }

  return `Local TTS returned HTTP ${response.status}`;
}

export async function GET() {
  try {
    const response = await fetchWithTimeout(
      `${getTTSBaseUrl()}/health`,
      { method: "GET" },
    );

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ??
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to reach local TTS.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function POST(request: Request) {
  let body: TTSRequestBody;

  try {
    body = (await request.json()) as TTSRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      { error: "text must be a string." },
      { status: 400 },
    );
  }

  const text = body.text.trim();

  if (!text) {
    return NextResponse.json(
      { error: "text is required." },
      { status: 400 },
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      {
        error: `text must not exceed ${MAX_TEXT_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  try {
    const response = await fetchWithTimeout(
      `${getTTSBaseUrl()}/synthesize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: await readServiceError(response) },
        { status: response.status },
      );
    }

    const audio = await response.arrayBuffer();

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
        "X-Jarvis-TTS-Model":
          response.headers.get(
            "X-Jarvis-TTS-Model",
          ) ?? "unknown",
        "X-Jarvis-TTS-Device":
          response.headers.get(
            "X-Jarvis-TTS-Device",
          ) ?? "unknown",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      error.name === "AbortError"
        ? "Local TTS timed out."
        : "Local TTS is not running.";

    return NextResponse.json(
      { error: message },
      { status: 503 },
    );
  }
}
