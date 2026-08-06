"use client";

export interface ConversationSummary {
  id: string;
  title: string;
  repositoryPath: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  loading: boolean;
  error: string;
  mobileOpen: boolean;
  disabled?: boolean;
  onMobileClose: () => void;
  onSelect: (conversationId: string) => Promise<void>;
  onNew: () => Promise<void>;
  onRename: (
    conversationId: string,
    title: string,
  ) => Promise<void>;
  onDelete: (
    conversationId: string,
  ) => Promise<void>;
}

function repositoryName(
  repositoryPath: string,
): string {
  const parts = repositoryPath
    .split("/")
    .filter(Boolean);

  return parts.at(-1) ?? repositoryPath;
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  const difference = Date.now() - timestamp;
  const minutes = Math.max(
    0,
    Math.floor(difference / 60_000),
  );

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(value).toLocaleDateString();
}

function ConversationList({
  conversations,
  activeConversationId,
  loading,
  error,
  disabled = false,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Omit<
  ConversationSidebarProps,
  "mobileOpen" | "onMobileClose"
>) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-zinc-800 p-4">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            void onNew();
          }}
          className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          New conversation
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && (
          <p className="px-2 py-4 text-sm text-zinc-500">
            Loading conversations...
          </p>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading &&
          !error &&
          conversations.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-700 p-4 text-sm leading-6 text-zinc-500">
              No conversations yet. Select a repository and start one.
            </div>
          )}

        <div className="space-y-2">
          {conversations.map((conversation) => {
            const active =
              conversation.id ===
              activeConversationId;

            return (
              <article
                key={conversation.id}
                className={`group rounded-xl border p-3 transition ${
                  active
                    ? "border-sky-500 bg-sky-500/10"
                    : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700"
                }`}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    void onSelect(
                      conversation.id,
                    );
                  }}
                  className="block w-full text-left disabled:cursor-not-allowed"
                >
                  <span className="block truncate text-sm font-medium text-zinc-100">
                    {conversation.title}
                  </span>

                  <span className="mt-1 block truncate text-xs text-zinc-500">
                    {repositoryName(
                      conversation.repositoryPath,
                    )}
                  </span>

                  <span className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-600">
                    <span>
                      {conversation.messageCount ?? 0}{" "}
                      messages
                    </span>

                    <span>
                      {relativeTime(
                        conversation.updatedAt,
                      )}
                    </span>
                  </span>
                </button>

                <div className="mt-3 flex gap-2 border-t border-zinc-800 pt-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const title = window.prompt(
                        "Rename conversation",
                        conversation.title,
                      );

                      if (
                        title !== null &&
                        title.trim() &&
                        title.trim() !==
                          conversation.title
                      ) {
                        void onRename(
                          conversation.id,
                          title.trim(),
                        );
                      }
                    }}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                  >
                    Rename
                  </button>

                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const confirmed =
                        window.confirm(
                          `Delete “${conversation.title}” and all its messages?`,
                        );

                      if (confirmed) {
                        void onDelete(
                          conversation.id,
                        );
                      }
                    }}
                    className="rounded-lg px-2 py-1 text-xs text-red-400 transition hover:bg-red-950/60 hover:text-red-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ConversationSidebar(
  props: ConversationSidebarProps,
) {
  const {
    mobileOpen,
    onMobileClose,
    ...listProps
  } = props;

  return (
    <>
      <aside className="hidden min-h-[650px] overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl lg:block">
        <ConversationList {...listProps} />
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm lg:hidden"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              onMobileClose();
            }
          }}
        >
          <aside className="flex h-full w-[min(88vw,360px)] flex-col border-r border-zinc-800 bg-zinc-900 shadow-2xl">
            <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-4">
              <h2 className="font-semibold">
                Conversations
              </h2>

              <button
                type="button"
                onClick={onMobileClose}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
              >
                Close
              </button>
            </header>

            <div className="min-h-0 flex-1">
              <ConversationList
                {...listProps}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
