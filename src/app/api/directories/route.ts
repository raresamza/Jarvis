import {
  access,
  readdir,
  realpath,
  stat,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DirectoryEntry {
  name: string;
  path: string;
  isGitRepository: boolean;
}

interface DirectoryListing {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  isGitRepository: boolean;
  entries: DirectoryEntry[];
}

function isInsideRoot(
  candidatePath: string,
  rootPath: string,
): boolean {
  const relativePath = path.relative(
    rootPath,
    candidatePath,
  );

  return (
    relativePath === "" ||
    (
      !relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath)
    )
  );
}

async function isGitRepository(
  directoryPath: string,
): Promise<boolean> {
  try {
    await access(path.join(directoryPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function resolveSafeDirectory(
  requestedPath: string | null,
  rootPath: string,
): Promise<string> {
  const candidatePath =
    requestedPath?.trim() || rootPath;

  const resolvedPath = await realpath(candidatePath);
  const information = await stat(resolvedPath);

  if (!information.isDirectory()) {
    throw new Error(
      "The requested path is not a directory.",
    );
  }

  if (!isInsideRoot(resolvedPath, rootPath)) {
    throw new Error(
      `Folder browsing is restricted to ${rootPath}.`,
    );
  }

  return resolvedPath;
}

export async function GET(
  request: Request,
): Promise<Response> {
  try {
    const configuredRoot =
      process.env.JARVIS_ALLOWED_ROOT ??
      path.join(os.homedir(), "projects");

    const rootPath = await realpath(configuredRoot);

    const url = new URL(request.url);

    const currentPath = await resolveSafeDirectory(
      url.searchParams.get("path"),
      rootPath,
    );

    const directoryEntries = await readdir(
      currentPath,
      {
        withFileTypes: true,
      },
    );

    const entries = (
      await Promise.all(
        directoryEntries.map(
          async (
            directoryEntry,
          ): Promise<DirectoryEntry | null> => {
            /*
             * The Git metadata directory should never be selected
             * or exposed as a normal project folder.
             */
            if (directoryEntry.name === ".git") {
              return null;
            }

            if (
              !directoryEntry.isDirectory() &&
              !directoryEntry.isSymbolicLink()
            ) {
              return null;
            }

            const unresolvedChildPath = path.join(
              currentPath,
              directoryEntry.name,
            );

            try {
              /*
               * realpath follows symbolic links. This prevents a
               * symlink inside the projects directory from escaping
               * to another location on the filesystem.
               */
              const childPath = await realpath(
                unresolvedChildPath,
              );

              if (!isInsideRoot(childPath, rootPath)) {
                return null;
              }

              const childInformation = await stat(
                childPath,
              );

              if (!childInformation.isDirectory()) {
                return null;
              }

              return {
                name: directoryEntry.name,
                path: childPath,
                isGitRepository:
                  await isGitRepository(childPath),
              };
            } catch {
              /*
               * Ignore unreadable directories and broken symbolic
               * links rather than failing the whole listing.
               */
              return null;
            }
          },
        ),
      )
    )
      .filter(
        (
          entry,
        ): entry is DirectoryEntry =>
          entry !== null,
      )
      .sort((left, right) => {
        /*
         * Show Git repositories first, then alphabetically.
         */
        if (
          left.isGitRepository !==
          right.isGitRepository
        ) {
          return left.isGitRepository ? -1 : 1;
        }

        return left.name.localeCompare(
          right.name,
          undefined,
          {
            sensitivity: "base",
          },
        );
      });

    let parentPath: string | null = null;

    if (currentPath !== rootPath) {
      const potentialParent = path.dirname(currentPath);

      parentPath = isInsideRoot(
        potentialParent,
        rootPath,
      )
        ? potentialParent
        : null;
    }

    const result: DirectoryListing = {
      rootPath,
      currentPath,
      parentPath,
      isGitRepository:
        await isGitRepository(currentPath),
      entries,
    };

    return Response.json(result, {
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
            : "Unable to browse directories.",
      },
      {
        status: 400,
      },
    );
  }
}
