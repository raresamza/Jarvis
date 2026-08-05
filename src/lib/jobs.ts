import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type JobMode = "ask" | "task";

export type JobState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JarvisJob {
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

export async function startJob(
  taskInput: string,
  repositoryInput: string,
  mode: JobMode,
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

  const id = randomUUID();
  const directory = getJobDirectory(id);
  const now = new Date().toISOString();

  await fsp.mkdir(directory, {
    recursive: true,
  });

  const initialJob: JarvisJob = {
    id,
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

  logStream.write(
    `Mode: ${mode}\n`,
  );

  logStream.write(
    `Repository: ${repository}\n`,
  );

  logStream.write(
    `Request: ${task}\n\n`,
  );

  const child = spawn(
    executable,
    [task],
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

    logStream.write(
      `\n[${new Date().toISOString()}] ` +
        `Job ${status} with exit code ` +
        `${String(exitCode)}\n`,
    );

    logStream.end();

    await updateJob(id, {
      status,
      exitCode,
      error,
      completedAt:
        new Date().toISOString(),
    });
  };

  child.on("error", (spawnError) => {
    void finish(
      "failed",
      null,
      spawnError.message,
    );
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
    );
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