const MAX_SPEECH_TEXT_CHARS = 6_000;
const DEFAULT_SEGMENT_CHARS = 240;

function decodeCommonEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&lt;/gi, " less than ")
    .replace(/&gt;/gi, " greater than ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function addTerminalPunctuation(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return /[.!?]$/.test(trimmed)
    ? trimmed
    : `${trimmed}.`;
}

/**
 * Convert the stored Markdown response into the exact text that may be spoken.
 * The rendered Markdown remains unchanged. Fenced code, raw URLs, image syntax,
 * HTML comments, and Markdown-only control characters are deliberately omitted.
 */
export function markdownToSpeechText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");

  text = text
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/^\s{0,3}\[[^\]]+\]:\s+\S+.*$/gm, "")
    .replace(/^\s{0,3}\[\^[^\]]+\]:.*$/gm, "")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, "")
    .replace(/^\s{0,3}>+\s?/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\|/g, ", ");

  text = decodeCommonEntities(text);

  const spokenLines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map(addTerminalPunctuation);

  return spokenLines
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_SPEECH_TEXT_CHARS);
}

function splitOversizedPiece(
  piece: string,
  maxChars: number,
): string[] {
  const words = piece.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current
      ? `${current} ${word}`
      : word;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      result.push(addTerminalPunctuation(current));
    }

    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    for (let index = 0; index < word.length; index += maxChars) {
      result.push(
        addTerminalPunctuation(
          word.slice(index, index + maxChars),
        ),
      );
    }

    current = "";
  }

  if (current) {
    result.push(addTerminalPunctuation(current));
  }

  return result;
}

/**
 * Keep each local TTS request short. Short segments reduce Chatterbox drift,
 * prevent the fixed generation token budget from cutting off long replies, and
 * allow playback to begin after the first segment is ready.
 */
export function splitSpeechText(
  text: string,
  maxChars = DEFAULT_SEGMENT_CHARS,
): string[] {
  const normalized = text.trim();

  if (!normalized) {
    return [];
  }

  const pieces =
    normalized.match(/[^.!?\n]+(?:[.!?]+|$)/g) ??
    [normalized];

  const segments: string[] = [];
  let current = "";

  for (const rawPiece of pieces) {
    const piece = rawPiece.replace(/\s+/g, " ").trim();

    if (!piece) {
      continue;
    }

    if (piece.length > maxChars) {
      if (current) {
        segments.push(current);
        current = "";
      }

      segments.push(
        ...splitOversizedPiece(piece, maxChars),
      );
      continue;
    }

    const candidate = current
      ? `${current} ${piece}`
      : piece;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    segments.push(current);
    current = piece;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}
