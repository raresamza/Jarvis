import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DatabaseInformation {
  database: string;
  username: string;
  postgresVersion: string;
}

interface TableInformation {
  tableName: string;
}

export async function GET(): Promise<Response> {
  try {
    const [
      databaseRows,
      tableRows,
      conversationCount,
      messageCount,
    ] = await Promise.all([
      prisma.$queryRaw<DatabaseInformation[]>`
        SELECT
          current_database()::text AS "database",
          current_user::text AS "username",
          version()::text AS "postgresVersion"
      `,

      prisma.$queryRaw<TableInformation[]>`
        SELECT
          table_name::text AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = 'app'
          AND table_name IN (
            'conversations',
            'messages'
          )
        ORDER BY table_name
      `,

      prisma.conversation.count(),

      prisma.message.count(),
    ]);

    const connection = databaseRows[0];

    if (!connection) {
      throw new Error(
        "PostgreSQL returned no connection information.",
      );
    }

    const availableTables = tableRows.map(
      (row) => row.tableName,
    );

    return Response.json(
      {
        ok: true,
        connection: {
          database: connection.database,
          user: connection.username,
          postgresVersion:
            connection.postgresVersion,
        },
        prisma: {
          connected: true,
          schema: "app",
        },
        tables: {
          expected: [
            "conversations",
            "messages",
          ],
          available: availableTables,
          allAvailable:
            availableTables.includes(
              "conversations",
            ) &&
            availableTables.includes(
              "messages",
            ),
        },
        counts: {
          conversations: conversationCount,
          messages: messageCount,
        },
        checkedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error: unknown) {
    console.error(
      "Database health check failed:",
      error,
    );

    return Response.json(
      {
        ok: false,
        error:
          "Jarvis could not connect to its PostgreSQL database.",
        checkedAt: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}
