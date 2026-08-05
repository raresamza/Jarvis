"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

export type VoiceSubmitMode =
  | "ask"
  | "task";

type VoiceState =
  | "idle"
  | "recording"
  | "transcribing";

interface TranscriptionResponse {
  text?: string;
  language?: string;
  languageProbability?: number;
  error?: string;
}

interface VoiceTaskInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onAutomaticSubmit?: (
    task: string,
    mode: VoiceSubmitMode,
  ) => Promise<void>;
}

const MAX_RECORDING_MS = 90_000;

function findSupportedMimeType():
  | string
  | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(
      candidate,
    ),
  );
}

function getFileExtension(
  mimeType: string,
): string {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return "webm";
}

export function VoiceTaskInput({
  value,
  onChange,
  disabled = false,
  onAutomaticSubmit,
}: VoiceTaskInputProps) {
  const [voiceState, setVoiceState] =
    useState<VoiceState>("idle");

  const [voiceError, setVoiceError] =
    useState("");

  const [
    detectedLanguage,
    setDetectedLanguage,
  ] = useState("");

  const [autoSubmit, setAutoSubmit] =
    useState(false);

  const [autoMode, setAutoMode] =
    useState<VoiceSubmitMode>("ask");

  const mediaRecorderRef =
    useRef<MediaRecorder | null>(null);

  const mediaStreamRef =
    useRef<MediaStream | null>(null);

  const audioChunksRef =
    useRef<Blob[]>([]);

  const automaticStopTimerRef =
    useRef<number | null>(null);

  const clearAutomaticStopTimer =
    (): void => {
      if (
        automaticStopTimerRef.current ===
        null
      ) {
        return;
      }

      window.clearTimeout(
        automaticStopTimerRef.current,
      );

      automaticStopTimerRef.current =
        null;
    };

  const releaseMicrophone = (): void => {
    mediaStreamRef.current
      ?.getTracks()
      .forEach((track) =>
        track.stop(),
      );

    mediaStreamRef.current = null;
  };

  const transcribeRecording = async (
    audioBlob: Blob,
  ): Promise<void> => {
    setVoiceState("transcribing");

    const formData = new FormData();

    const extension =
      getFileExtension(audioBlob.type);

    formData.append(
      "audio",
      audioBlob,
      `jarvis-command.${extension}`,
    );

    const response = await fetch(
      "/api/transcribe",
      {
        method: "POST",
        body: formData,
      },
    );

    const result =
      (await response.json()) as
        TranscriptionResponse;

    if (
      !response.ok ||
      result.error
    ) {
      throw new Error(
        result.error ||
          "Unable to transcribe audio.",
      );
    }

    const transcript =
      result.text?.trim();

    if (!transcript) {
      throw new Error(
        "No speech was detected.",
      );
    }

    onChange(transcript);

    if (result.language) {
      const probability =
        typeof result.languageProbability ===
        "number"
          ? ` ${Math.round(
              result.languageProbability *
                100,
            )}%`
          : "";

      setDetectedLanguage(
        `${result.language.toUpperCase()}` +
          probability,
      );
    }

    if (
      autoSubmit &&
      onAutomaticSubmit
    ) {
      await onAutomaticSubmit(
        transcript,
        autoMode,
      );
    }
  };

  const stopRecording = (): void => {
    clearAutomaticStopTimer();

    const recorder =
      mediaRecorderRef.current;

    if (
      recorder?.state === "recording"
    ) {
      recorder.stop();
    }
  };

  const startRecording =
    async (): Promise<void> => {
      setVoiceError("");
      setDetectedLanguage("");

      if (
        !navigator.mediaDevices
          ?.getUserMedia ||
        typeof MediaRecorder ===
          "undefined"
      ) {
        setVoiceError(
          "This browser does not support microphone recording.",
        );

        return;
      }

      try {
        const stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: false,
            },
          );

        mediaStreamRef.current = stream;
        audioChunksRef.current = [];

        const mimeType =
          findSupportedMimeType();

        const recorder =
          new MediaRecorder(
            stream,
            mimeType
              ? {
                  mimeType,
                }
              : undefined,
          );

        mediaRecorderRef.current =
          recorder;

        recorder.addEventListener(
          "dataavailable",
          (event: BlobEvent) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(
                event.data,
              );
            }
          },
        );

        recorder.addEventListener(
          "error",
          () => {
            clearAutomaticStopTimer();
            releaseMicrophone();

            setVoiceState("idle");

            setVoiceError(
              "The browser encountered a recording error.",
            );
          },
        );

        recorder.addEventListener(
          "stop",
          async () => {
            clearAutomaticStopTimer();
            releaseMicrophone();

            const recordingType =
              recorder.mimeType ||
              mimeType ||
              "audio/webm";

            const audioBlob =
              new Blob(
                audioChunksRef.current,
                {
                  type: recordingType,
                },
              );

            mediaRecorderRef.current =
              null;

            audioChunksRef.current = [];

            if (audioBlob.size === 0) {
              setVoiceState("idle");

              setVoiceError(
                "The microphone recording was empty.",
              );

              return;
            }

            try {
              await transcribeRecording(
                audioBlob,
              );
            } catch (
              transcriptionError
            ) {
              setVoiceError(
                transcriptionError instanceof
                  Error
                  ? transcriptionError.message
                  : "Unable to transcribe the recording.",
              );
            } finally {
              setVoiceState("idle");
            }
          },
        );

        recorder.start();
        setVoiceState("recording");

        automaticStopTimerRef.current =
          window.setTimeout(() => {
            stopRecording();
          }, MAX_RECORDING_MS);
      } catch (microphoneError) {
        releaseMicrophone();
        setVoiceState("idle");

        setVoiceError(
          microphoneError instanceof
            Error
            ? microphoneError.message
            : "Microphone permission was denied.",
        );
      }
    };

  useEffect(() => {
    return () => {
      clearAutomaticStopTimer();

      if (
        mediaRecorderRef.current
          ?.state === "recording"
      ) {
        mediaRecorderRef.current.stop();
      }

      releaseMicrophone();
    };
  }, []);

  const buttonLabel =
    voiceState === "recording"
      ? "Stop and transcribe"
      : voiceState ===
          "transcribing"
        ? "Transcribing..."
        : "Speak";

  return (
    <div>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">
          Request
        </span>

        <textarea
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          disabled={disabled}
          className="h-48 w-full resize-none overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm leading-6 outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Ask about the project or describe a coding task..."
          required
        />
      </label>

      <div className="mt-3 flex flex-col gap-3">
        <button
          type="button"
          disabled={
            disabled ||
            voiceState ===
              "transcribing"
          }
          onClick={() => {
            if (
              voiceState === "recording"
            ) {
              stopRecording();
              return;
            }

            void startRecording();
          }}
          aria-pressed={
            voiceState === "recording"
          }
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            voiceState === "recording"
              ? "border-red-500 bg-red-950/50 text-red-200"
              : "border-zinc-700 bg-zinc-950 text-zinc-100 hover:border-sky-500"
          }`}
        >
          <span
            className={`h-3 w-3 rounded-full ${
              voiceState === "recording"
                ? "animate-pulse bg-red-500"
                : voiceState ===
                    "transcribing"
                  ? "animate-pulse bg-amber-400"
                  : "bg-sky-400"
            }`}
          />

          {buttonLabel}
        </button>

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={autoSubmit}
            onChange={(event) =>
              setAutoSubmit(
                event.target.checked,
              )
            }
            disabled={disabled}
            className="h-4 w-4 accent-sky-500"
          />

          Run automatically after transcription
        </label>

        {autoSubmit && (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setAutoMode("ask")
              }
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                autoMode === "ask"
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Ask Jarvis
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setAutoMode("task")
              }
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                autoMode === "task"
                  ? "bg-sky-500 text-zinc-950"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Delegate task
            </button>
          </div>
        )}
      </div>

      {voiceState === "recording" && (
        <p className="mt-3 text-sm text-red-300">
          Listening. Speak your request,
          then press Stop.
        </p>
      )}

      {voiceState ===
        "transcribing" && (
        <p className="mt-3 text-sm text-amber-300">
          Transcribing locally with
          Whisper...
        </p>
      )}

      {detectedLanguage && (
        <p className="mt-3 text-xs text-zinc-500">
          Detected language:{" "}
          {detectedLanguage}
        </p>
      )}

      {voiceError && (
        <div className="mt-3 rounded-xl border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
          {voiceError}
        </div>
      )}
    </div>
  );
}