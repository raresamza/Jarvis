import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TranscriptionResult {
  text: string;
  language?: string;
  languageProbability?: number;
  duration?: number;
}

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 180_000;
const MAX_PROCESS_OUTPUT = 2 * 1024 * 1024;

function getAudioExtension(mimeType: string): string {
  const normalizedType = mimeType.toLowerCase();

  if (normalizedType.includes("mp4")) {
    return "m4a";
  }

  if (normalizedType.includes("ogg")) {
    return "ogg";
  }

  if (normalizedType.includes("wav")) {
    return "wav";
  }

  return "webm";
}

function runTranscription(
  audioPath: string,
): Promise<TranscriptionResult> {
  const python =
    process.env.JARVIS_WHISPER_PYTHON ??
    path.join(
      process.cwd(),
      ".venv-whisper",
      "bin",
      "python",
    );

  const script =
    process.env.JARVIS_WHISPER_SCRIPT ??
    path.join(process.cwd(), "scripts", "transcribe.py");

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, audioPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finishWithError = (message: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(message));
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");

      finishWithError(
        "Voice transcription exceeded the three-minute timeout.",
      );
    }, TRANSCRIPTION_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      if (stdout.length > MAX_PROCESS_OUTPUT) {
        child.kill("SIGKILL");
        finishWithError("Transcription output was unexpectedly large.");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();

      if (stderr.length > MAX_PROCESS_OUTPUT) {
        stderr = stderr.slice(-MAX_PROCESS_OUTPUT);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      finishWithError(error.message);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);

      if (settled) {
        return;
      }

      if (exitCode !== 0) {
        finishWithError(
          stderr.trim() ||
            `Whisper exited with code ${String(exitCode)}.`,
        );
        return;
      }

      try {
        const result = JSON.parse(
          stdout.trim(),
        ) as TranscriptionResult;

        if (typeof result.text !== "string") {
          finishWithError(
            "Whisper returned an invalid transcription result.",
          );
          return;
        }

        settled = true;
        resolve(result);
      } catch {
        finishWithError(
          `Unable to parse Whisper output: ${stdout.slice(0, 500)}`,
        );
      }
    });
  });
}

export async function POST(
  request: Request,
): Promise<Response> {
  let temporaryDirectory: string | undefined;

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return Response.json(
        {
          error: "An audio file is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (audio.size === 0) {
      return Response.json(
        {
          error: "The audio recording is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return Response.json(
        {
          error: "The recording is too large.",
        },
        {
          status: 413,
        },
      );
    }

    const python =
      process.env.JARVIS_WHISPER_PYTHON ??
      path.join(
        process.cwd(),
        ".venv-whisper",
        "bin",
        "python",
      );

    const script =
      process.env.JARVIS_WHISPER_SCRIPT ??
      path.join(process.cwd(), "scripts", "transcribe.py");

    await Promise.all([access(python), access(script)]);

    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "jarvis-voice-"),
    );

    const extension = getAudioExtension(audio.type);
    const audioPath = path.join(
      temporaryDirectory,
      `recording.${extension}`,
    );

    const audioBuffer = Buffer.from(
      await audio.arrayBuffer(),
    );

    await writeFile(audioPath, audioBuffer);

    const transcription = await runTranscription(audioPath);

    if (!transcription.text.trim()) {
      return Response.json(
        {
          error: "No speech was detected.",
        },
        {
          status: 422,
        },
      );
    }

    return Response.json(transcription, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to transcribe the recording.",
      },
      {
        status: 500,
      },
    );
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }
  }
}
