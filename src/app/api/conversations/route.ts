import {
  ConversationValidationError,
  createConversation,
  listConversations,
} from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function GET(): Promise<Response> {
  try {
    const conversations =
      await listConversations();

    return Response.json(
      {
        conversations,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error: unknown) {
    console.error(
      "Failed to list conversations:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to load conversations.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(
  request: Request,
): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
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

  if (!isRecord(body)) {
    return Response.json(
      {
        error:
          "The request body must be an object.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (
    typeof body.repository !== "string"
  ) {
    return Response.json(
      {
        error:
          "The repository field is required.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  if (
    body.title !== undefined &&
    typeof body.title !== "string"
  ) {
    return Response.json(
      {
        error:
          "The title field must be a string.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const conversation =
      await createConversation(
        body.repository,
        body.title as
          | string
          | undefined,
      );

    return Response.json(
      {
        conversation,
      },
      {
        status: 201,
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error: unknown) {
    if (
      error instanceof
      ConversationValidationError
    ) {
      return Response.json(
        {
          error: error.message,
        },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    console.error(
      "Failed to create conversation:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to create the conversation.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
