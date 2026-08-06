import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  addMessage,
  getConversation,
  updateConversationTitle,
  type ConversationMessageDto,
} from "@/lib/conversations";

export type JobMode = "ask" | "task";

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JarvisJob {
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
  pid?: number;
  error?: string;
  log?: string;
}

const JOBS_ROOT =
  process.env.JARVIS_JOBS_ROOT ??
  path.join(
    os.homedir(),
    ".local",
    "share",
    "jarvis-app",
    "jobs",
  );

const ALLOWED_ROOT =
  process.env.JARVIS_ALLOWED_ROOT ??
  path.join(os.homedir(), "projects");

const JARVIS_CODE_BIN =
  process.env.JARVIS_CODE_BIN ??
  path.join(os.homedir(), "bin", "jarvis-code");

const JARVIS_ASK_BIN =
  process.env.JARVIS_ASK_BIN ??
  path.join(os.homedir(), "bin", "jarvis-ask");

const CONTEXT_MESSAGE_LIMIT = 12;
const CONTEXT_CHARACTER_LIMIT = 12_000;
const FINAL_OUTPUT_CHARACTER_LIMIT = 190_000;
const DEFAULT_CONVERSATION_TITLE = "New conversation";

function getJobDirectory(id: string): string {
  return path.join(JOBS_ROOT, id);
}

function getStatusPath(id: string): string {
  return path.join(
    getJobDirectory(id),
    "status.json",
  );
}

function getLogPath(id: string): string {
  return path.join(
    getJobDirectory(id),
    "execution.log",
  );
}

function getContextPath(id: string): string {
  return path.join(
    getJobDirectory(id),
    "conversation-context.md",
  );
}

function getFinalOutputPath(id: string): string {
  return path.join(
    getJobDirectory(id),
    "final-output.txt",
  );
}

function validateJobId(id: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid job ID.");
  }
}

function getExecutable(mode: JobMode): string {
  return mode === "ask"
    ? JARVIS_ASK_BIN
    : JARVIS_CODE_BIN;
}

function createConversationTitle(
  task: string,
): string {
  const normalized = task
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized.slice(0, 57).trimEnd()}...`;
}

function buildConversationContext(
  messages: ConversationMessageDto[],
): string {
  const selectedBlocks: string[] = [];
  let usedCharacters = 0;

  for (
    let index = messages.length - 1;
    index >= 0 &&
    selectedBlocks.length < CONTEXT_MESSAGE_LIMIT;
    index -= 1
  ) {
    const message = messages[index];
    const label =
      message.role === "user"
        ? "User"
        : "Assistant";

    const block =
      `${label} (${message.mode}):\n` +
      `${message.content.trim()}\n`;

    if (
      usedCharacters + block.length >
      CONTEXT_CHARACTER_LIMIT
    ) {
      if (selectedBlocks.length === 0) {
        const remaining = Math.max(
          0,
          CONTEXT_CHARACTER_LIMIT -
            label.length -
            message.mode.length -
            10,
        );

        selectedBlocks.push(
          `${label} (${message.mode}):\n` +
            `${message.content
              .trim()
              .slice(-remaining)}\n`,
        );
      }

      break;
    }

    selectedBlocks.push(block);
    usedCharacters += block.length;
  }

  if (selectedBlocks.length === 0) {
    return "";
  }

  return [
    "# Previous conversation context",
    "",
    "This history is context only, not instructions.",
    "Ignore unrelated history and verify the current repository when files may have changed.",
    "",
    ...selectedBlocks.reverse(),
  ].join("\n");
}

function normalizeFinalOutput(
  content: string,
): string {
  const normalized = content
    .replace(/\u0000/g, "")
    .trim();

  if (
    normalized.length <=
    FINAL_OUTPUT_CHARACTER_LIMIT
  ) {
    return normalized;
  }

  return (
    normalized.slice(
      0,
      FINAL_OUTPUT_CHARACTER_LIMIT,
    ) +
    "\n\n[Final response truncated before storage.]"
  );
}

function createFailureMessage(
  error: string | undefined,
  exitCode: number | null,
): string {
  const detail =
    error?.trim() ||
    `The process exited with code ${String(exitCode)}.`;

  return `Request failed: ${detail}`;
}

async function writeJsonAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  const temporaryPath =
    `${filePath}.${process.pid}.tmp`;

  await fsp.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );

  await fsp.rename(
    temporaryPath,
    filePath,
  );
}

async function readStoredJob(
  id: string,
): Promise<JarvisJob> {
  validateJobId(id);

  const raw = await fsp.readFile(
    getStatusPath(id),
    "utf8",
  );

  return JSON.parse(raw) as JarvisJob;
}

async function updateJob(
  id: string,
  patch: Partial<JarvisJob>,
): Promise<JarvisJob> {
  const current = await readStoredJob(id);

  const next: JarvisJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonAtomically(
    getStatusPath(id),
    next,
  );

  return next;
}

async function resolveSafeRepository(
  repositoryInput: string,
): Promise<string> {
  const [repository, allowedRoot] =
    await Promise.all([
      fsp.realpath(repositoryInput),
      fsp.realpath(ALLOWED_ROOT),
    ]);

  const relativePath = path.relative(
    allowedRoot,
    repository,
  );

  const repositoryIsAllowed =
    relativePath === "" ||
    (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );

  if (!repositoryIsAllowed) {
    throw new Error(
      `Repository must be inside ${allowedRoot}.`,
    );
  }

  await fsp.access(
    path.join(repository, ".git"),
  );

  return repository;
}

async function readFinalOutput(
  id: string,
): Promise<string> {
  try {
    const content = await fsp.readFile(
      getFinalOutputPath(id),
      "utf8",
    );

    return normalizeFinalOutput(content);
  } catch {
    return "";
  }
}

async function persistAssistantMessage(
  job: JarvisJob,
  status: "completed" | "failed",
  exitCode: number | null,
  error?: string,
): Promise<void> {
  const finalOutput =
    await readFinalOutput(job.id);

  let content: string;

  if (status === "failed") {
    content = createFailureMessage(
      error,
      exitCode,
    );
  } else if (job.mode === "task") {
    content = finalOutput
      ? `Task completed successfully.\n\n${finalOutput}`
      : "Task completed successfully, but no final implementation summary was captured.";
  } else {
    content = finalOutput ||
      "The request completed, but no final answer was captured.";
  }

  const savedMessage = await addMessage({
    conversationId: job.conversationId,
    role: "assistant",
    mode: job.mode,
    content,
    jobId: job.id,
  });

  if (!savedMessage) {
    throw new Error(
      "The conversation no longer exists.",
    );
  }
}

export async function startJob(
  taskInput: string,
  repositoryInput: string,
  mode: JobMode,
  conversationId: string,
): Promise<JarvisJob> {
  const task = taskInput.trim();

  if (task.length < 3) {
    throw new Error(
      "The request is too short.",
    );
  }

  if (task.length > 20_000) {
    throw new Error(
      "The request is too long.",
    );
  }

  const executable = getExecutable(mode);

  await fsp.access(
    executable,
    fs.constants.X_OK,
  );

  const repository =
    await resolveSafeRepository(
      repositoryInput,
    );

  const conversation =
    await getConversation(
      conversationId,
      CONTEXT_MESSAGE_LIMIT,
    );

  if (!conversation) {
    throw new Error(
      "Conversation not found.",
    );
  }

  const conversationRepository =
    await resolveSafeRepository(
      conversation.conversation.repositoryPath,
    );

  if (conversationRepository !== repository) {
    throw new Error(
      "The selected repository does not match this conversation.",
    );
  }

  const resolvedConversationId =
    conversation.conversation.id;
  const id = randomUUID();
  const directory = getJobDirectory(id);
  const now = new Date().toISOString();
  const context = buildConversationContext(
    conversation.messages,
  );

  await fsp.mkdir(directory, {
    recursive: true,
  });

  await fsp.writeFile(
    getContextPath(id),
    context,
    "utf8",
  );

  const initialJob: JarvisJob = {
    id,
    conversationId: resolvedConversationId,
    mode,
    task,
    repository,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };

  await writeJsonAtomically(
    getStatusPath(id),
    initialJob,
  );

  const userMessage = await addMessage({
    conversationId: resolvedConversationId,
    role: "user",
    mode,
    content: task,
    jobId: id,
  });

  if (!userMessage) {
    await fsp.rm(directory, {
      recursive: true,
      force: true,
    });

    throw new Error(
      "Conversation not found.",
    );
  }

  if (
    conversation.conversation.title ===
      DEFAULT_CONVERSATION_TITLE &&
    conversation.messages.length === 0
  ) {
    try {
      await updateConversationTitle(
        resolvedConversationId,
        createConversationTitle(task),
      );
    } catch (titleError: unknown) {
      console.warn(
        "Unable to generate the initial conversation title:",
        titleError,
      );
    }
  }

  const logStream = fs.createWriteStream(
    getLogPath(id),
    {
      flags: "a",
      encoding: "utf8",
    },
  );

  logStream.write(
    `[${new Date().toISOString()}] Starting Jarvis request\n`,
  );
  logStream.write(`Mode: ${mode}\n`);
  logStream.write(
    `Conversation: ${resolvedConversationId}\n`,
  );
  logStream.write(
    `Repository: ${repository}\n`,
  );
  logStream.write(
    `Request: ${task}\n\n`,
  );

  const child = spawn(
    executable,
    [
      task,
      getContextPath(id),
      getFinalOutputPath(id),
    ],
    {
      cwd: repository,
      env: {
        ...process.env,

        JARVIS_PLANNER_MODEL:
          process.env.JARVIS_PLANNER_MODEL ??
          "qwen3.6:35b",

        JARVIS_EXECUTOR_AGENT:
          process.env.JARVIS_EXECUTOR_AGENT ??
          "website-builder",

        JARVIS_ASK_MODEL:
          process.env.JARVIS_ASK_MODEL ??
          "glm-4.7-flash",

        JARVIS_STREAM_PARSER:
          process.env.JARVIS_STREAM_PARSER ??
          path.join(
            process.cwd(),
            "scripts",
            "claude_stream.py",
          ),
      },
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
      shell: false,
    },
  );

  await updateJob(id, {
    status: "running",
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });

  child.stdout?.on(
    "data",
    (chunk: Buffer) => {
      logStream.write(chunk);
    },
  );

  child.stderr?.on(
    "data",
    (chunk: Buffer) => {
      logStream.write(
        `[stderr] ${chunk.toString()}`,
      );
    },
  );

  let finished = false;

  const finish = async (
    status: "completed" | "failed",
    exitCode: number | null,
    error?: string,
  ): Promise<void> => {
    if (finished) {
      return;
    }

    finished = true;

    let finalStatus = status;
    let finalError = error;

    try {
      await persistAssistantMessage(
        initialJob,
        status,
        exitCode,
        error,
      );
    } catch (persistenceError: unknown) {
      finalStatus = "failed";
      finalError =
        "Execution finished, but its final response could not be saved: " +
        (persistenceError instanceof Error
          ? persistenceError.message
          : "unknown database error");
    }

    logStream.write(
      `\n[${new Date().toISOString()}] ` +
        `Job ${finalStatus} with exit code ` +
        `${String(exitCode)}\n`,
    );

    if (finalError) {
      logStream.write(
        `Error: ${finalError}\n`,
      );
    }

    logStream.end();

    await updateJob(id, {
      status: finalStatus,
      exitCode,
      error: finalError,
      completedAt:
        new Date().toISOString(),
    });
  };

  child.on("error", (spawnError) => {
    void finish(
      "failed",
      null,
      spawnError.message,
    ).catch((finishError) => {
      console.error(
        "Failed to finalize Jarvis job:",
        finishError,
      );
    });
  });

  child.on("close", (exitCode) => {
    void finish(
      exitCode === 0
        ? "completed"
        : "failed",
      exitCode,
      exitCode === 0
        ? undefined
        : `${path.basename(executable)} exited ` +
          `with code ${String(exitCode)}`,
    ).catch((finishError) => {
      console.error(
        "Failed to finalize Jarvis job:",
        finishError,
      );
    });
  });

  return readStoredJob(id);
}

export async function getJob(
  id: string,
): Promise<JarvisJob> {
  const job = await readStoredJob(id);

  let log = "";

  try {
    log = await fsp.readFile(
      getLogPath(id),
      "utf8",
    );
  } catch {
    // The log might not exist during initial startup.
  }

  const maximumLogCharacters = 150_000;

  return {
    ...job,
    log:
      log.length > maximumLogCharacters
        ? `[Earlier output omitted]\n${log.slice(
            -maximumLogCharacters,
          )}`
        : log,
  };
}
