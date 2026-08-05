"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

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

interface RepositoryPickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface Breadcrumb {
  label: string;
  path: string;
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.1c.6 0 1.17.24 1.59.66l1.15 1.18c.28.26.64.41 1.02.41H18A2.25 2.25 0 0 1 20.25 9v7.5A2.25 2.25 0 0 1 18 18.75H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 5 7 7-7 7"
      />
    </svg>
  );
}

function BrowseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.1c.6 0 1.17.24 1.59.66l1.15 1.18c.28.26.64.41 1.02.41H18A2.25 2.25 0 0 1 20.25 9v7.5A2.25 2.25 0 0 1 18 18.75H6a2.25 2.25 0 0 1-2.25-2.25V6.75Z"
      />
    </svg>
  );
}

export function RepositoryPicker({
  value,
  onChange,
  disabled = false,
}: RepositoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const [listing, setListing] =
    useState<DirectoryListing | null>(null);

  const [loading, setLoading] = useState(false);
  const [browserError, setBrowserError] =
    useState("");

  const loadDirectory = async (
    directoryPath?: string,
  ): Promise<void> => {
    setLoading(true);
    setBrowserError("");

    try {
      const parameters = new URLSearchParams();

      if (directoryPath) {
        parameters.set("path", directoryPath);
      }

      const query = parameters.toString();

      const response = await fetch(
        `/api/directories${query ? `?${query}` : ""}`,
        {
          cache: "no-store",
        },
      );

      const result = (await response.json()) as
        | DirectoryListing
        | { error: string };

      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result
            ? result.error
            : "Unable to load the directory.",
        );
      }

      setListing(result);
    } catch (error) {
      setBrowserError(
        error instanceof Error
          ? error.message
          : "Unable to load the directory.",
      );
    } finally {
      setLoading(false);
    }
  };

  const openBrowser = (): void => {
    setIsOpen(true);

    /*
     * Try to open at the current value. If it is invalid,
     * the user can return to the configured root.
     */
    void loadDirectory(value.trim() || undefined);
  };

  const closeBrowser = (): void => {
    if (loading) {
      return;
    }

    setIsOpen(false);
    setBrowserError("");
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        closeBrowser();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [isOpen, loading]);

  const breadcrumbs = useMemo<Breadcrumb[]>(() => {
    if (!listing) {
      return [];
    }

    const rootName =
      listing.rootPath
        .split("/")
        .filter(Boolean)
        .at(-1) || listing.rootPath;

    const result: Breadcrumb[] = [
      {
        label: rootName,
        path: listing.rootPath,
      },
    ];

    if (
      listing.currentPath === listing.rootPath
    ) {
      return result;
    }

    const relativePath =
      listing.currentPath.slice(
        listing.rootPath.length,
      );

    const segments = relativePath
      .split("/")
      .filter(Boolean);

    let accumulatedPath = listing.rootPath;

    for (const segment of segments) {
      accumulatedPath = `${accumulatedPath}/${segment}`;

      result.push({
        label: segment,
        path: accumulatedPath,
      });
    }

    return result;
  }, [listing]);

  const selectCurrentRepository = (): void => {
    if (!listing?.isGitRepository) {
      return;
    }

    onChange(listing.currentPath);
    setIsOpen(false);
  };

  return (
    <>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">
          Repository
        </span>

        <div className="flex gap-2">
          <input
            value={value}
            onChange={(event) =>
              onChange(event.target.value)
            }
            disabled={disabled}
            className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none transition focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="/home/rares/projects/project-name"
            required
          />

          <button
            type="button"
            onClick={openBrowser}
            disabled={disabled}
            aria-label="Browse repositories"
            title="Browse repositories"
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-300 transition hover:border-sky-500 hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BrowseIcon />
          </button>
        </div>
      </label>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeBrowser();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="repository-browser-title"
            className="flex max-h-[80dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div>
                <h2
                  id="repository-browser-title"
                  className="text-xl font-semibold"
                >
                  Select repository
                </h2>

                <p className="mt-1 text-sm text-zinc-400">
                  Browse folders under the approved
                  projects directory.
                </p>
              </div>

              <button
                type="button"
                onClick={closeBrowser}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
              >
                Close
              </button>
            </header>

            <div className="shrink-0 border-b border-zinc-800 px-6 py-4">
              <div className="flex flex-wrap items-center gap-1 text-sm">
                {breadcrumbs.map(
                  (breadcrumb, index) => (
                    <div
                      key={breadcrumb.path}
                      className="flex items-center"
                    >
                      {index > 0 && (
                        <ChevronRightIcon />
                      )}

                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          void loadDirectory(
                            breadcrumb.path,
                          );
                        }}
                        className="rounded-md px-2 py-1 text-zinc-300 transition hover:bg-zinc-800 hover:text-sky-300 disabled:opacity-50"
                      >
                        {breadcrumb.label}
                      </button>
                    </div>
                  ),
                )}
              </div>

              <p className="mt-3 break-all font-mono text-xs text-zinc-500">
                {listing?.currentPath ??
                  "Loading directory..."}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-6 py-3">
                <button
                  type="button"
                  disabled={
                    loading ||
                    !listing?.parentPath
                  }
                  onClick={() => {
                    if (listing?.parentPath) {
                      void loadDirectory(
                        listing.parentPath,
                      );
                    }
                  }}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Up one level
                </button>

                <button
                  type="button"
                  disabled={loading || !listing}
                  onClick={() => {
                    if (listing) {
                      void loadDirectory(
                        listing.currentPath,
                      );
                    }
                  }}
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-sm transition hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Refresh
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {loading && (
                  <div className="flex min-h-48 items-center justify-center text-sm text-zinc-400">
                    Loading folders...
                  </div>
                )}

                {!loading && browserError && (
                  <div className="m-3 rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-200">
                    <p>{browserError}</p>

                    <button
                      type="button"
                      onClick={() => {
                        void loadDirectory();
                      }}
                      className="mt-3 rounded-lg border border-red-800 px-3 py-2 transition hover:bg-red-900/50"
                    >
                      Return to projects root
                    </button>
                  </div>
                )}

                {!loading &&
                  !browserError &&
                  listing?.entries.length === 0 && (
                    <div className="flex min-h-48 items-center justify-center text-sm text-zinc-500">
                      This folder contains no subfolders.
                    </div>
                  )}

                {!loading &&
                  !browserError &&
                  listing?.entries.map((entry) => (
                    <button
                      type="button"
                      key={entry.path}
                      onClick={() => {
                        void loadDirectory(entry.path);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-zinc-800"
                    >
                      <span
                        className={
                          entry.isGitRepository
                            ? "text-sky-400"
                            : "text-zinc-500"
                        }
                      >
                        <FolderIcon />
                      </span>

                      <span className="min-w-0 flex-1 truncate">
                        {entry.name}
                      </span>

                      {entry.isGitRepository && (
                        <span className="shrink-0 rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-xs text-emerald-300">
                          Git repository
                        </span>
                      )}

                      <ChevronRightIcon />
                    </button>
                  ))}
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-800 px-6 py-5">
              <div className="text-sm">
                {listing?.isGitRepository ? (
                  <p className="text-emerald-300">
                    This folder can be selected.
                  </p>
                ) : (
                  <p className="text-zinc-500">
                    Navigate to a folder containing a
                    Git repository.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 gap-3">
                <button
                  type="button"
                  onClick={closeBrowser}
                  className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium transition hover:border-zinc-500"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    loading ||
                    !listing?.isGitRepository
                  }
                  onClick={selectCurrentRepository}
                  className="rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select repository
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
