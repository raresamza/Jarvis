import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParameters {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  _request: Request,
  context: RouteParameters,
): Promise<Response> {
  try {
    const { id } = await context.params;
    const job = await getJob(id);

    return Response.json(job, {
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
            : "Job not found.",
      },
      {
        status: 404,
      },
    );
  }
}
