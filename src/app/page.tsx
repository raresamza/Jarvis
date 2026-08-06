"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ConversationSidebar,
  type ConversationSummary,
} from "@/components/ConversationSidebar";
import { JarvisSpeechControls } from "@/components/JarvisSpeechControls";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import {
  VoiceTaskInput,
  type VoiceSubmitMode,
} from "@/components/VoiceTaskInput";
import { useJarvisSpeech } from "@/hooks/useJarvisSpeech";

type JobMode = "ask" | "task";
type RightPanelTab =
  | "conversation"
  | "activity";

type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface JarvisJob {
  id: string;
  conversationId: string;
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

interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  mode: JobMode;
  content: string;
  jobId: string | null;
  createdAt: string;
}

interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}

interface ApiError {
  error: string;
}

const terminalStates: JobState[] = [
  "completed",
  "failed",
  "cancelled",
];

function isApiError(
  value: unknown,
): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiError).error ===
      "string"
  );
}

async function parseResponse<T>(
  response: Response,
): Promise<T> {
  const result = (await response.json()) as
    | T
    | ApiError;

  if (!response.ok || isApiError(result)) {
    throw new Error(
      isApiError(result)
        ? result.error
        : "The request failed.",
    );
  }

  return result;
}

function makeConversationTitle(
  task: string,
): string {
  const normalized = task
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "New conversation";
  }

  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized
    .slice(0, 57)
    .trimEnd()}...`;
}

function normalizeRepositoryPath(
  repositoryPath: string,
): string {
  return repositoryPath
    .trim()
    .replace(/\/+$/, "");
}

function formatMessageTime(
  value: string,
): string {
  return new Date(value).toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

export default function Home() {
  const [repository, setRepository] =
    useState(
      "/home/rares/projects/jarvis",
    );

  const [task, setTask] = useState("");
  const [job, setJob] =
    useState<JarvisJob | null>(null);

  const [startingMode, setStartingMode] =
    useState<JobMode | null>(null);

  const [error, setError] =
    useState("");

  const [conversations, setConversations] =
    useState<ConversationSummary[]>([]);

  const [conversationDetail, setConversationDetail] =
    useState<ConversationDetail | null>(null);

  const [conversationsLoading, setConversationsLoading] =
    useState(true);

  const [conversationLoading, setConversationLoading] =
    useState(false);

  const [conversationError, setConversationError] =
    useState("");

  const [rightPanelTab, setRightPanelTab] =
    useState<RightPanelTab>("conversation");

  const [mobileSidebarOpen, setMobileSidebarOpen] =
    useState(false);

  const logContainer =
    useRef<HTMLPreElement>(null);

  const handledTerminalJobId =
    useRef<string | null>(null);

  const {
    supported: speechSupported,
    enabled: speechEnabled,
    engine: speechEngine,
    speaking,
    speechError,
    voices,
    voiceName,
    setEnabled: setSpeechEnabled,
    setEngine: setSpeechEngine,
    setVoiceName,
    speak,
    stop: stopSpeaking,
  } = useJarvisSpeech();

  const activeConversation =
    conversationDetail?.conversation ?? null;

  const activeConversationId =
    activeConversation?.id ?? null;

  const repositoryMismatch = useMemo(() => {
    if (!activeConversation) {
      return false;
    }

    return (
      normalizeRepositoryPath(
        activeConversation.repositoryPath,
      ) !==
      normalizeRepositoryPath(repository)
    );
  }, [activeConversation, repository]);

  const isBusy =
    startingMode !== null ||
    job?.status === "running" ||
    job?.status === "queued";

  const controlsDisabled =
    isBusy || conversationsLoading;

  const loadConversationList =
    useCallback(async (): Promise<
      ConversationSummary[]
    > => {
      const response = await fetch(
        "/api/conversations",
        {
          cache: "no-store",
        },
      );

      const result = await parseResponse<{
        conversations: ConversationSummary[];
      }>(response);

      setConversations(
        result.conversations,
      );

      return result.conversations;
    }, []);

  const loadConversation = useCallback(
    async (
      conversationId: string,
      options?: {
        preserveJob?: boolean;
      },
    ): Promise<ConversationDetail> => {
      setConversationLoading(true);
      setConversationError("");

      try {
        const response = await fetch(
          `/api/conversations/${conversationId}`,
          {
            cache: "no-store",
          },
        );

        const result =
          await parseResponse<ConversationDetail>(
            response,
          );

        setConversationDetail(result);
        setRepository(
          result.conversation.repositoryPath,
        );

        if (!options?.preserveJob) {
          setJob(null);
          setError("");
        }

        return result;
      } finally {
        setConversationLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async (): Promise<void> => {
      setConversationsLoading(true);
      setConversationError("");

      try {
        const loadedConversations =
          await loadConversationList();

        if (
          !cancelled &&
          loadedConversations[0]
        ) {
          await loadConversation(
            loadedConversations[0].id,
          );
        }
      } catch (initializationError) {
        if (!cancelled) {
          setConversationError(
            initializationError instanceof Error
              ? initializationError.message
              : "Unable to load conversations.",
          );
        }
      } finally {
        if (!cancelled) {
          setConversationsLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadConversation,
    loadConversationList,
  ]);

  const createConversation = useCallback(
    async (
      title = "New conversation",
    ): Promise<ConversationSummary> => {
      const repositoryPath =
        repository.trim();

      if (!repositoryPath) {
        throw new Error(
          "Select a repository first.",
        );
      }

      const response = await fetch(
        "/api/conversations",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            repository: repositoryPath,
            title,
          }),
        },
      );

      const result = await parseResponse<{
        conversation: ConversationSummary;
      }>(response);

      setConversationDetail({
        conversation: result.conversation,
        messages: [],
      });

      setConversations((current) => [
        result.conversation,
        ...current.filter(
          (conversation) =>
            conversation.id !==
            result.conversation.id,
        ),
      ]);

      setJob(null);
      setError("");
      setRightPanelTab("conversation");
      setMobileSidebarOpen(false);

      return result.conversation;
    },
    [repository],
  );

  const handleNewConversation =
    useCallback(async (): Promise<void> => {
      try {
        await createConversation();
      } catch (creationError) {
        setError(
          creationError instanceof Error
            ? creationError.message
            : "Unable to create a conversation.",
        );
      }
    }, [createConversation]);

  const handleSelectConversation =
    useCallback(
      async (
        conversationId: string,
      ): Promise<void> => {
        try {
          await loadConversation(
            conversationId,
          );
          setRightPanelTab(
            "conversation",
          );
          setMobileSidebarOpen(false);
        } catch (selectionError) {
          setConversationError(
            selectionError instanceof Error
              ? selectionError.message
              : "Unable to load the conversation.",
          );
        }
      },
      [loadConversation],
    );

  const handleRenameConversation =
    useCallback(
      async (
        conversationId: string,
        title: string,
      ): Promise<void> => {
        try {
          const response = await fetch(
            `/api/conversations/${conversationId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({ title }),
            },
          );

          const result = await parseResponse<{
            conversation: ConversationSummary;
          }>(response);

          setConversations((current) =>
            current.map((conversation) =>
              conversation.id ===
              conversationId
                ? {
                    ...conversation,
                    ...result.conversation,
                  }
                : conversation,
            ),
          );

          setConversationDetail((current) =>
            current?.conversation.id ===
            conversationId
              ? {
                  ...current,
                  conversation: {
                    ...current.conversation,
                    ...result.conversation,
                  },
                }
              : current,
          );
        } catch (renameError) {
          setError(
            renameError instanceof Error
              ? renameError.message
              : "Unable to rename the conversation.",
          );
        }
      },
      [],
    );

  const handleDeleteConversation =
    useCallback(
      async (
        conversationId: string,
      ): Promise<void> => {
        try {
          const response = await fetch(
            `/api/conversations/${conversationId}`,
            {
              method: "DELETE",
            },
          );

          await parseResponse<{
            deleted: boolean;
          }>(response);

          const remaining =
            conversations.filter(
              (conversation) =>
                conversation.id !==
                conversationId,
            );

          setConversations(remaining);

          if (
            activeConversationId ===
            conversationId
          ) {
            setConversationDetail(null);
            setJob(null);

            if (remaining[0]) {
              await loadConversation(
                remaining[0].id,
              );
            }
          }
        } catch (deleteError) {
          setError(
            deleteError instanceof Error
              ? deleteError.message
              : "Unable to delete the conversation.",
          );
        }
      },
      [
        activeConversationId,
        conversations,
        loadConversation,
      ],
    );

  const refreshJob = useCallback(
    async (id: string): Promise<void> => {
      const response = await fetch(
        `/api/jobs/${id}`,
        {
          cache: "no-store",
        },
      );

      const result =
        await parseResponse<JarvisJob>(
          response,
        );

      setJob(result);
    },
    [],
  );

  const currentJobId = job?.id;
  const currentJobStatus = job?.status;
  const currentJobConversationId =
    job?.conversationId;

  useEffect(() => {
    if (
      !currentJobId ||
      !currentJobStatus ||
      terminalStates.includes(
        currentJobStatus,
      )
    ) {
      return;
    }

    const timer = window.setInterval(
      () => {
        void refreshJob(
          currentJobId,
        ).catch((refreshError: unknown) => {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Unable to refresh the request.",
          );
        });
      },
      2000,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [
    currentJobId,
    currentJobStatus,
    refreshJob,
  ]);

  useEffect(() => {
    if (
      !currentJobId ||
      !currentJobStatus ||
      !currentJobConversationId ||
      !terminalStates.includes(
        currentJobStatus,
      ) ||
      handledTerminalJobId.current ===
        currentJobId
    ) {
      return;
    }

    handledTerminalJobId.current =
      currentJobId;

    const finalize = async (): Promise<void> => {
      try {
        const detail =
          await loadConversation(
            currentJobConversationId,
            {
              preserveJob: true,
            },
          );

        await loadConversationList();
        setRightPanelTab("conversation");

        const assistantMessage =
          [...detail.messages]
            .reverse()
            .find(
              (message) =>
                message.role ===
                  "assistant" &&
                message.jobId ===
                  currentJobId,
            );

        if (assistantMessage) {
          speak(assistantMessage.content);
        }
      } catch (finalizationError) {
        setError(
          finalizationError instanceof Error
            ? finalizationError.message
            : "Unable to refresh the completed conversation.",
        );
      }
    };

    void finalize();
  }, [
    currentJobConversationId,
    currentJobId,
    currentJobStatus,
    loadConversation,
    loadConversationList,
    speak,
  ]);

  const currentLog = job?.log;

  useEffect(() => {
    if (
      rightPanelTab !== "activity" ||
      !logContainer.current
    ) {
      return;
    }

    logContainer.current.scrollTop =
      logContainer.current.scrollHeight;
  }, [currentLog, rightPanelTab]);

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
    setTask(requestedTask);

    try {
      let conversationId =
        activeConversationId;

      if (
        activeConversation &&
        repositoryMismatch
      ) {
        throw new Error(
          `This conversation belongs to ${activeConversation.repositoryPath}. Start a new conversation before using ${repository.trim()}.`,
        );
      }

      if (!conversationId) {
        const createdConversation =
          await createConversation(
            makeConversationTitle(
              requestedTask,
            ),
          );

        conversationId =
          createdConversation.id;
      }

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
            conversationId,
          }),
        },
      );

      const result =
        await parseResponse<JarvisJob>(
          response,
        );

      handledTerminalJobId.current = null;
      setJob(result);
      setRightPanelTab("activity");

      await loadConversation(
        conversationId,
        {
          preserveJob: true,
        },
      );

      await loadConversationList();
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
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 lg:py-10">
      <div className="mx-auto mb-4 flex max-w-[1500px] items-center justify-between lg:hidden">
        <button
          type="button"
          onClick={() =>
            setMobileSidebarOpen(true)
          }
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium"
        >
          Conversations
        </button>

        <span className="max-w-[55vw] truncate text-sm text-zinc-500">
          {activeConversation?.title ??
            "No conversation"}
        </span>
      </div>

      <div className="mx-auto grid max-w-[1500px] items-stretch gap-6 lg:grid-cols-[270px_420px_minmax(0,1fr)]">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={
            activeConversationId
          }
          loading={conversationsLoading}
          error={conversationError}
          mobileOpen={mobileSidebarOpen}
          disabled={isBusy}
          onMobileClose={() =>
            setMobileSidebarOpen(false)
          }
          onSelect={
            handleSelectConversation
          }
          onNew={handleNewConversation}
          onRename={
            handleRenameConversation
          }
          onDelete={
            handleDeleteConversation
          }
        />

        <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <div className="mb-8">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-sky-400">
              Local AI control center
            </p>

            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              Jarvis
            </h1>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Ask questions about a repository or delegate implementation work.
            </p>
          </div>

          <div className="mb-5">
            <JarvisSpeechControls
              supported={speechSupported}
              enabled={speechEnabled}
              engine={speechEngine}
              speaking={speaking}
              speechError={speechError}
              voices={voices}
              voiceName={voiceName}
              onEnabledChange={
                setSpeechEnabled
              }
              onEngineChange={
                setSpeechEngine
              }
              onVoiceChange={setVoiceName}
              onStop={stopSpeaking}
            />
          </div>

          <form
            className="space-y-5"
            onSubmit={submitAsQuestion}
          >
            <RepositoryPicker
              value={repository}
              onChange={(value) => {
                setRepository(value);
                setError("");
              }}
              disabled={controlsDisabled}
            />

            {repositoryMismatch &&
              activeConversation && (
                <div className="rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-100">
                  <p>
                    The active conversation is tied to:
                  </p>

                  <p className="mt-1 break-all font-mono text-xs text-amber-300">
                    {activeConversation.repositoryPath}
                  </p>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      void handleNewConversation();
                    }}
                    className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50"
                  >
                    Start a new conversation for this repository
                  </button>
                </div>
              )}

            <VoiceTaskInput
              value={task}
              onChange={setTask}
              disabled={
                controlsDisabled ||
                repositoryMismatch
              }
              onAutomaticSubmit={
                handleAutomaticVoiceSubmit
              }
            />

            <div className="grid grid-cols-2 gap-3">
              <button
                type="submit"
                disabled={
                  controlsDisabled ||
                  repositoryMismatch
                }
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
                disabled={
                  controlsDisabled ||
                  repositoryMismatch
                }
                onClick={() => {
                  void submitRequest("task");
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
            <header className="shrink-0 border-b border-zinc-800 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-500">
                    {activeConversation
                      ? "Current conversation"
                      : "Conversation"}
                  </p>

                  <p className="mt-1 truncate font-medium">
                    {activeConversation?.title ??
                      "No conversation selected"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2 rounded-full border border-zinc-700 px-3 py-1.5 text-sm">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      job?.status ===
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
              </div>

              <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
                <button
                  type="button"
                  onClick={() =>
                    setRightPanelTab(
                      "conversation",
                    )
                  }
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    rightPanelTab ===
                    "conversation"
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Conversation
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setRightPanelTab(
                      "activity",
                    )
                  }
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                    rightPanelTab ===
                    "activity"
                      ? "bg-sky-500 text-zinc-950"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Activity
                </button>
              </div>
            </header>

            {rightPanelTab ===
            "conversation" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
                {conversationLoading && (
                  <p className="text-sm text-zinc-500">
                    Loading conversation...
                  </p>
                )}

                {!conversationLoading &&
                  !activeConversation && (
                    <div className="rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-sm leading-6 text-zinc-500">
                      Select or create a conversation, then ask Jarvis a question.
                    </div>
                  )}

                {!conversationLoading &&
                  activeConversation &&
                  conversationDetail
                    .messages.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-zinc-700 p-6 text-center text-sm leading-6 text-zinc-500">
                      This conversation has no messages yet.
                    </div>
                  )}

                <div className="space-y-5">
                  {conversationDetail?.messages.map(
                    (message) => (
                      <article
                        key={message.id}
                        className={`flex ${
                          message.role ===
                          "user"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl border px-4 py-3 ${
                            message.role ===
                            "user"
                              ? "border-sky-700 bg-sky-950/50"
                              : "border-zinc-700 bg-zinc-950/70"
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-4 text-[11px] uppercase tracking-wide text-zinc-500">
                            <span>
                              {message.role ===
                              "user"
                                ? "You"
                                : "Jarvis"}
                            </span>

                            <div className="flex items-center gap-3">
                              <span>
                                {message.mode ===
                                "ask"
                                  ? "Ask"
                                  : "Task"}
                                {" · "}
                                {formatMessageTime(
                                  message.createdAt,
                                )}
                              </span>

                              {message.role ===
                                "assistant" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    speak(
                                      message.content,
                                    )
                                  }
                                  className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-sky-300 transition hover:border-sky-700 hover:text-sky-200"
                                >
                                  Speak
                                </button>
                              )}
                            </div>
                          </div>

                          <MarkdownMessage
                            content={message.content}
                          />
                        </div>
                      </article>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <>
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
                    "Jarvis activity will appear here after a request starts."}
                </pre>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
