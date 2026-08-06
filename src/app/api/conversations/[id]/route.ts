import {
  ConversationValidationError,
  deleteConversation,
  getConversation,
  updateConversationTitle,
} from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

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

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } =
      await context.params;

    const result =
      await getConversation(id);

    if (!result) {
      return Response.json(
        {
          error:
            "Conversation not found.",
        },
        {
          status: 404,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return Response.json(
      result,
      {
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
      "Failed to load conversation:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to load the conversation.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
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

  if (
    !isRecord(body) ||
    typeof body.title !== "string"
  ) {
    return Response.json(
      {
        error:
          "The title field is required.",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const { id } =
      await context.params;

    const conversation =
      await updateConversationTitle(
        id,
        body.title,
      );

    if (!conversation) {
      return Response.json(
        {
          error:
            "Conversation not found.",
        },
        {
          status: 404,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return Response.json(
      {
        conversation,
      },
      {
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
      "Failed to rename conversation:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to rename the conversation.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const { id } =
      await context.params;

    const deleted =
      await deleteConversation(id);

    if (!deleted) {
      return Response.json(
        {
          error:
            "Conversation not found.",
        },
        {
          status: 404,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    return Response.json(
      {
        deleted: true,
      },
      {
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
      "Failed to delete conversation:",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to delete the conversation.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
