import {
  startJob,
  type JobMode,
} from "@/lib/jobs";

export const runtime = "nodejs";

interface StartJobBody {
  task?: unknown;
  repository?: unknown;
  mode?: unknown;
}

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
  try {
    const body =
      (await request.json()) as StartJobBody;

    if (
      typeof body.task !== "string" ||
      typeof body.repository !== "string"
    ) {
      return Response.json(
        {
          error:
            "Both task and repository must be strings.",
        },
        {
          status: 400,
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
        },
      );
    }

    const job = await startJob(
      body.task,
      body.repository,
      body.mode,
    );

    return Response.json(job, {
      status: 202,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start the request.",
      },
      {
        status: 400,
      },
    );
  }
}