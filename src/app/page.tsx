"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { RepositoryPicker } from "@/components/RepositoryPicker";
import { JarvisSpeechControls } from "@/components/JarvisSpeechControls";
import { useJarvisSpeech } from "@/hooks/useJarvisSpeech";

import {
  VoiceTaskInput,
  type VoiceSubmitMode,
} from "@/components/VoiceTaskInput";

type JobMode = "ask" | "task";

type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface JarvisJob {
  id: string;
  mode: JobMode;
  task: string;
  repository: string;
  status: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  error?: string;
  log?: string;
}

const terminalStates: JobState[] = [
  "completed",
  "failed",
  "cancelled",
];

function prepareJarvisSpeech(
  job: JarvisJob,
): string {
  if (job.status === "failed") {
    return (
      "The request failed. " +
      "Please check the activity log."
    );
  }

  if (job.mode === "task") {
    return (
      "The delegated task has completed. " +
      "The result and validation details " +
      "are displayed on screen."
    );
  }

  const log = job.log ?? "";

  const ignoredLinePatterns = [
    /^\[.*\]$/,
    /^Mode:/i,
    /^Repository:/i,
    /^Model:/i,
    /^Question:/i,
    /^Request:/i,
    /^Run files:/i,
    /^Output:/i,
    /^Events:/i,
    /^Debug:/i,
    /^Ask Jarvis finished/i,
    /^Task execution finished/i,
    /^Job (completed|failed)/i,
  ];

  const cleaned = log
    /*
     * Do not read source-code blocks aloud.
     */
    .replace(
      /```[\s\S]*?```/g,
      " Code block omitted. ",
    )
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return true;
      }

      return !ignoredLinePatterns.some(
        (pattern) =>
          pattern.test(trimmed),
      );
    })
    .join(" ")
    .replace(
      /\[([^\]]+)\]\([^)]+\)/g,
      "$1",
    )
    .replace(
      /^#{1,6}\s+/gm,
      "",
    )
    .replace(
      /[*_`>#]/g,
      "",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();

  if (!cleaned) {
    return (
      "I have completed the request. " +
      "The answer is displayed on screen."
    );
  }

  const maximumCharacters = 1800;

  if (
    cleaned.length >
    maximumCharacters
  ) {
    return (
      `${cleaned.slice(
        0,
        maximumCharacters,
      )}. ` +
      "The full answer is displayed on screen."
    );
  }

  return cleaned;
}

export default function Home() {
  const [repository, setRepository] =
    useState(
      "/home/rares/projects/claude-qwen-test",
    );

  const [task, setTask] =
    useState("");

  const [job, setJob] =
    useState<JarvisJob | null>(null);

  const [
    startingMode,
    setStartingMode,
  ] = useState<JobMode | null>(null);

  const [error, setError] =
    useState("");

  const logContainer =
    useRef<HTMLPreElement>(null);

  const lastSpokenJobId =
    useRef<string | null>(null);

  const {
    supported: speechSupported,
    enabled: speechEnabled,
    speaking,
    voices,
    voiceName,
    setEnabled: setSpeechEnabled,
    setVoiceName,
    speak,
    stop: stopSpeaking,
  } = useJarvisSpeech();

  const isBusy =
    startingMode !== null ||
    job?.status === "running" ||
    job?.status === "queued";

  const refreshJob = async (
    id: string,
  ): Promise<void> => {
    const response = await fetch(
      `/api/jobs/${id}`,
      {
        cache: "no-store",
      },
    );

    const result =
      (await response.json()) as
      | JarvisJob
      | { error: string };

    if (
      !response.ok ||
      "error" in result
    ) {
      throw new Error(
        "error" in result
          ? result.error
          : "Unable to refresh the request.",
      );
    }

    setJob(result);
  };

  useEffect(() => {
    if (
      !job ||
      terminalStates.includes(
        job.status,
      )
    ) {
      return;
    }

    const timer =
      window.setInterval(() => {
        void refreshJob(job.id).catch(
          (
            refreshError: unknown,
          ) => {
            setError(
              refreshError instanceof
                Error
                ? refreshError.message
                : "Unable to refresh the request.",
            );
          },
        );
      }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!logContainer.current) {
      return;
    }

    logContainer.current.scrollTop =
      logContainer.current.scrollHeight;
  }, [job?.log]);

  useEffect(() => {
    if (
      !job ||
      !terminalStates.includes(
        job.status,
      ) ||
      lastSpokenJobId.current ===
      job.id
    ) {
      return;
    }

    lastSpokenJobId.current =
      job.id;

    speak(
      prepareJarvisSpeech(job),
    );
  }, [
    job?.id,
    job?.status,
    job?.mode,
    job?.log,
    speak,
  ]);

  const submitRequest = async (
    mode: JobMode,
    taskOverride?: string,
  ): Promise<void> => {
    const requestedTask = (
      taskOverride ?? task
    ).trim();

    if (!requestedTask) {
      setError(
        "Enter or record a request first.",
      );

      return;
    }

    stopSpeaking();
    setStartingMode(mode);
    setError("");
    setJob(null);
    setTask(requestedTask);

    try {
      const response = await fetch(
        "/api/jobs",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            repository,
            task: requestedTask,
            mode,
          }),
        },
      );

      const result =
        (await response.json()) as
        | JarvisJob
        | { error: string };

      if (
        !response.ok ||
        "error" in result
      ) {
        throw new Error(
          "error" in result
            ? result.error
            : "Unable to start the request.",
        );
      }

      setJob(result);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Unable to start the request.",
      );
    } finally {
      setStartingMode(null);
    }
  };

  const submitAsQuestion = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();

    await submitRequest("ask");
  };

  const handleAutomaticVoiceSubmit =
    async (
      transcript: string,
      mode: VoiceSubmitMode,
    ): Promise<void> => {
      await submitRequest(
        mode,
        transcript,
      );
    };

  const statusLabel =
    job?.status === "completed"
      ? "Completed"
      : job?.status === "failed"
        ? "Failed"
        : job?.status === "running"
          ? job.mode === "ask"
            ? "Answering"
            : "Working"
          : job?.status === "queued"
            ? "Queued"
            : "Ready";

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-100">
      <div className="mx-auto grid max-w-6xl items-stretch gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="mb-8">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-sky-400">
              Local AI control center
            </p>

            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Jarvis
            </h1>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Ask questions about a repository
              or delegate implementation work.
            </p>
          </div>

          <div className="mb-5">
            <JarvisSpeechControls
              supported={speechSupported}
              enabled={speechEnabled}
              speaking={speaking}
              voices={voices}
              voiceName={voiceName}
              onEnabledChange={
                setSpeechEnabled
              }
              onVoiceChange={
                setVoiceName
              }
              onStop={stopSpeaking}
            />
          </div>

          <form
            className="space-y-5"
            onSubmit={submitAsQuestion}
          >
            <RepositoryPicker
              value={repository}
              onChange={setRepository}
              disabled={isBusy}
            />

            <VoiceTaskInput
              value={task}
              onChange={setTask}
              disabled={isBusy}
              onAutomaticSubmit={
                handleAutomaticVoiceSubmit
              }
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="submit"
                disabled={isBusy}
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingMode === "ask"
                  ? "Starting..."
                  : job?.status ===
                    "running" &&
                    job.mode === "ask"
                    ? "Answering..."
                    : "Ask Jarvis"}
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  void submitRequest(
                    "task",
                  );
                }}
                className="rounded-xl bg-sky-500 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {startingMode === "task"
                  ? "Starting..."
                  : job?.status ===
                    "running" &&
                    job.mode === "task"
                    ? "Working..."
                    : "Delegate task"}
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-5 rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
              {error}
            </div>
          )}
        </section>

        <div className="relative min-w-0 lg:min-h-0">
          <section className="flex min-h-[650px] min-w-0 flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl lg:absolute lg:inset-0 lg:min-h-0">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div className="min-w-0">
                <p className="text-sm text-zinc-500">
                  Current request
                </p>

                <p className="mt-1 break-words font-medium">
                  {job
                    ? job.task
                    : "No request has been submitted yet."}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-sm">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${job?.status ===
                    "completed"
                    ? "bg-emerald-400"
                    : job?.status ===
                      "failed"
                      ? "bg-red-400"
                      : job?.status ===
                        "running"
                        ? "animate-pulse bg-sky-400"
                        : job?.status ===
                          "queued"
                          ? "animate-pulse bg-amber-400"
                          : "bg-zinc-500"
                    }`}
                />

                {statusLabel}
              </div>
            </header>

            {job && (
              <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-zinc-800 px-6 py-4 text-xs text-zinc-400 md:grid-cols-5">
                <div>
                  <span className="block text-zinc-600">
                    Mode
                  </span>

                  <span>
                    {job.mode === "ask"
                      ? "Ask"
                      : "Task"}
                  </span>
                </div>

                <div>
                  <span className="block text-zinc-600">
                    Job ID
                  </span>

                  <span>
                    {job.id.slice(0, 8)}
                  </span>
                </div>

                <div>
                  <span className="block text-zinc-600">
                    Exit code
                  </span>

                  <span>
                    {job.exitCode ??
                      (terminalStates.includes(
                        job.status,
                      )
                        ? "None"
                        : "Running")}
                  </span>
                </div>

                <div>
                  <span className="block text-zinc-600">
                    Started
                  </span>

                  <span>
                    {job.startedAt
                      ? new Date(
                        job.startedAt,
                      ).toLocaleTimeString()
                      : "Pending"}
                  </span>
                </div>

                <div>
                  <span className="block text-zinc-600">
                    Updated
                  </span>

                  <span>
                    {new Date(
                      job.updatedAt,
                    ).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            )}

            <pre
              ref={logContainer}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words bg-black/40 p-6 font-mono text-xs leading-5 text-emerald-300"
            >
              {job?.log ||
                "Jarvis output will appear here after a request starts."}
            </pre>
          </section>
        </div>
      </div>
    </main>
  );
}