import {
  startJob,
  type JobMode,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartJobBody {
  task?: unknown;
  repository?: unknown;
  mode?: unknown;
  conversationId?: unknown;
}

const NO_STORE_HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",
};

function isJobMode(
  value: unknown,
): value is JobMode {
  return (
    value === "ask" ||
    value === "task"
  );
}

export async function POST(
  request: Request,
): Promise<Response> {
  let body: StartJobBody;

  try {
    body =
      (await request.json()) as StartJobBody;
  } catch {
    return Response.json(
      {
        error:
          "The request body must contain valid JSON.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (
    typeof body.task !== "string" ||
    typeof body.repository !== "string" ||
    typeof body.conversationId !== "string"
  ) {
    return Response.json(
      {
        error:
          "task, repository, and conversationId must be strings.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (!isJobMode(body.mode)) {
    return Response.json(
      {
        error:
          'Mode must be either "ask" or "task".',
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const job = await startJob(
      body.task,
      body.repository,
      body.mode,
      body.conversationId,
    );

    return Response.json(job, {
      status: 202,
      headers: NO_STORE_HEADERS,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start the request.";

    const isNotFound =
      message === "Conversation not found.";

    return Response.json(
      {
        error: message,
      },
      {
        status: isNotFound ? 404 : 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
