import "server-only";

import * as path from "node:path";

import prisma from "@/lib/prisma";

export type ConversationMessageRole =
  | "user"
  | "assistant";

export type ConversationJobMode =
  | "ask"
  | "task";

export interface ConversationDto {
  id: string;
  title: string;
  repositoryPath: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface ConversationMessageDto {
  id: string;
  conversationId: string;
  role: ConversationMessageRole;
  mode: ConversationJobMode;
  content: string;
  jobId: string | null;
  createdAt: string;
}

export interface ConversationDetailDto {
  conversation: ConversationDto;
  messages: ConversationMessageDto[];
}

export interface AddMessageInput {
  conversationId: string;
  role: ConversationMessageRole;
  mode: ConversationJobMode;
  content: string;
  jobId?: string | null;
}

const DEFAULT_CONVERSATION_TITLE =
  "New conversation";

const MAX_TITLE_LENGTH = 120;
const MAX_REPOSITORY_PATH_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 200_000;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LIMIT = 500;
const MAX_CONVERSATION_LIST_SIZE = 250;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const roleToDatabaseValue = {
  user: "USER",
  assistant: "ASSISTANT",
} as const;

const modeToDatabaseValue = {
  ask: "ASK",
  task: "TASK",
} as const;

export class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

function normalizeWhitespace(
  value: string,
): string {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeConversationId(
  value: string,
): string {
  const normalizedValue = value.trim();

  if (!UUID_PATTERN.test(normalizedValue)) {
    throw new ConversationValidationError(
      "The conversation ID is invalid.",
    );
  }

  return normalizedValue;
}

function normalizeOptionalJobId(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!UUID_PATTERN.test(normalizedValue)) {
    throw new ConversationValidationError(
      "The job ID is invalid.",
    );
  }

  return normalizedValue;
}

function normalizeRepositoryPath(
  repositoryPath: string,
): string {
  const normalizedValue =
    repositoryPath.trim();

  if (!normalizedValue) {
    throw new ConversationValidationError(
      "A repository path is required.",
    );
  }

  if (
    normalizedValue.length >
    MAX_REPOSITORY_PATH_LENGTH
  ) {
    throw new ConversationValidationError(
      "The repository path is too long.",
    );
  }

  if (!path.isAbsolute(normalizedValue)) {
    throw new ConversationValidationError(
      "The repository path must be absolute.",
    );
  }

  return path.normalize(normalizedValue);
}

function normalizeTitle(
  title?: string,
): string {
  if (title === undefined) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  const normalizedTitle =
    normalizeWhitespace(title);

  if (!normalizedTitle) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  if (
    normalizedTitle.length >
    MAX_TITLE_LENGTH
  ) {
    throw new ConversationValidationError(
      `The conversation title cannot exceed ${MAX_TITLE_LENGTH} characters.`,
    );
  }

  return normalizedTitle;
}

function normalizeMessageContent(
  content: string,
): string {
  const normalizedContent =
    content.trim();

  if (!normalizedContent) {
    throw new ConversationValidationError(
      "Message content cannot be empty.",
    );
  }

  if (
    normalizedContent.length >
    MAX_MESSAGE_LENGTH
  ) {
    throw new ConversationValidationError(
      `Message content cannot exceed ${MAX_MESSAGE_LENGTH} characters.`,
    );
  }

  return normalizedContent;
}

function normalizeMessageLimit(
  limit: number,
): number {
  if (
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    return DEFAULT_MESSAGE_LIMIT;
  }

  return Math.min(
    limit,
    MAX_MESSAGE_LIMIT,
  );
}

function mapConversation(
  conversation: {
    id: string;
    title: string;
    repositoryPath: string;
    createdAt: Date;
    updatedAt: Date;
    _count?: {
      messages: number;
    };
  },
): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    repositoryPath:
      conversation.repositoryPath,
    createdAt:
      conversation.createdAt.toISOString(),
    updatedAt:
      conversation.updatedAt.toISOString(),
    ...(conversation._count
      ? {
          messageCount:
            conversation._count.messages,
        }
      : {}),
  };
}

function mapMessage(
  message: {
    id: string;
    conversationId: string;
    role: string;
    mode: string;
    content: string;
    jobId: string | null;
    createdAt: Date;
  },
): ConversationMessageDto {
  return {
    id: message.id,
    conversationId:
      message.conversationId,
    role:
      message.role === "USER"
        ? "user"
        : "assistant",
    mode:
      message.mode === "ASK"
        ? "ask"
        : "task",
    content: message.content,
    jobId: message.jobId,
    createdAt:
      message.createdAt.toISOString(),
  };
}

export async function createConversation(
  repositoryPath: string,
  title?: string,
): Promise<ConversationDto> {
  const normalizedRepositoryPath =
    normalizeRepositoryPath(
      repositoryPath,
    );

  const normalizedTitle =
    normalizeTitle(title);

  const conversation =
    await prisma.conversation.create({
      data: {
        repositoryPath:
          normalizedRepositoryPath,
        title: normalizedTitle,
      },
    });

  return mapConversation(conversation);
}

export async function listConversations():
  Promise<ConversationDto[]> {
  const conversations =
    await prisma.conversation.findMany({
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: MAX_CONVERSATION_LIST_SIZE,
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

  return conversations.map(
    mapConversation,
  );
}

export async function getConversation(
  id: string,
  messageLimit =
    DEFAULT_MESSAGE_LIMIT,
): Promise<ConversationDetailDto | null> {
  const conversationId =
    normalizeConversationId(id);

  const normalizedLimit =
    normalizeMessageLimit(
      messageLimit,
    );

  const conversation =
    await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
        messages: {
          orderBy: [
            {
              createdAt: "desc",
            },
            {
              id: "desc",
            },
          ],
          take: normalizedLimit,
        },
      },
    });

  if (!conversation) {
    return null;
  }

  const messages = [
    ...conversation.messages,
  ]
    .reverse()
    .map(mapMessage);

  return {
    conversation:
      mapConversation(conversation),
    messages,
  };
}

export async function updateConversationTitle(
  id: string,
  title: string,
): Promise<ConversationDto | null> {
  const conversationId =
    normalizeConversationId(id);

  const normalizedTitle =
    normalizeTitle(title);

  const updateResult =
    await prisma.conversation.updateMany({
      where: {
        id: conversationId,
      },
      data: {
        title: normalizedTitle,
      },
    });

  if (updateResult.count === 0) {
    return null;
  }

  const conversation =
    await prisma.conversation.findUnique({
      where: {
        id: conversationId,
      },
      include: {
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

  return conversation
    ? mapConversation(conversation)
    : null;
}

export async function deleteConversation(
  id: string,
): Promise<boolean> {
  const conversationId =
    normalizeConversationId(id);

  const result =
    await prisma.conversation.deleteMany({
      where: {
        id: conversationId,
      },
    });

  return result.count > 0;
}

export async function addMessage(
  input: AddMessageInput,
): Promise<ConversationMessageDto | null> {
  const conversationId =
    normalizeConversationId(
      input.conversationId,
    );

  const content =
    normalizeMessageContent(
      input.content,
    );

  const jobId =
    normalizeOptionalJobId(
      input.jobId,
    );

  const databaseRole =
    roleToDatabaseValue[input.role];

  const databaseMode =
    modeToDatabaseValue[input.mode];

  if (!databaseRole) {
    throw new ConversationValidationError(
      "The message role is invalid.",
    );
  }

  if (!databaseMode) {
    throw new ConversationValidationError(
      "The message mode is invalid.",
    );
  }

  return prisma.$transaction(
    async (transaction) => {
      const conversation =
        await transaction.conversation.findUnique({
          where: {
            id: conversationId,
          },
          select: {
            id: true,
          },
        });

      if (!conversation) {
        return null;
      }

      const message =
        await transaction.message.create({
          data: {
            conversationId,
            role: databaseRole,
            mode: databaseMode,
            content,
            jobId,
          },
        });

      await transaction.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return mapMessage(message);
    },
  );
}

export async function getConversationMessages(
  id: string,
  limit =
    DEFAULT_MESSAGE_LIMIT,
): Promise<ConversationMessageDto[]> {
  const conversationId =
    normalizeConversationId(id);

  const normalizedLimit =
    normalizeMessageLimit(limit);

  const messages =
    await prisma.message.findMany({
      where: {
        conversationId,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: normalizedLimit,
    });

  return messages
    .reverse()
    .map(mapMessage);
}

export async function updateConversationTimestamp(
  id: string,
): Promise<boolean> {
  const conversationId =
    normalizeConversationId(id);

  const result =
    await prisma.conversation.updateMany({
      where: {
        id: conversationId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

  return result.count > 0;
}
