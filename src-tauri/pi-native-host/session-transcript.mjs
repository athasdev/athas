import { readFile } from "node:fs/promises";

const normalizeText = (value) => value.replace(/\s+/g, " ").trim();
const TIMELINE_ENTRY_TYPES = new Set(["message", "model_change", "thinking_level_change"]);

const extractBlockText = (content) => {
  if (typeof content === "string") {
    const normalized = normalizeText(content);
    return normalized ? normalized : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  const normalized = normalizeText(text);
  return normalized ? normalized : null;
};

const resolveTimestamp = (entry) => {
  if (typeof entry?.timestamp === "string") {
    return entry.timestamp;
  }

  if (typeof entry?.message?.timestamp === "number") {
    return new Date(entry.message.timestamp).toISOString();
  }

  return null;
};

const createTranscriptEntry = ({
  entry,
  entryType,
  role = null,
  content = null,
  provider = null,
  modelId = null,
  thinkingLevel = null,
}) => {
  const timestamp = resolveTimestamp(entry);
  if (!timestamp) {
    return null;
  }

  return {
    id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
    entryType,
    role,
    content,
    timestamp,
    provider,
    modelId,
    thinkingLevel,
  };
};

export function parseSessionTranscript(lines) {
  return lines.flatMap((line) => {
    if (!line.trim()) {
      return [];
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return [];
    }

    if (!TIMELINE_ENTRY_TYPES.has(entry?.type)) {
      return [];
    }

    if (entry.type === "model_change") {
      if (typeof entry.provider !== "string" || typeof entry.modelId !== "string") {
        return [];
      }

      const transcriptEntry = createTranscriptEntry({
        entry,
        entryType: "model_change",
        provider: entry.provider,
        modelId: entry.modelId,
      });
      return transcriptEntry ? [transcriptEntry] : [];
    }

    if (entry.type === "thinking_level_change") {
      if (typeof entry.thinkingLevel !== "string") {
        return [];
      }

      const transcriptEntry = createTranscriptEntry({
        entry,
        entryType: "thinking_level_change",
        thinkingLevel: entry.thinkingLevel,
      });
      return transcriptEntry ? [transcriptEntry] : [];
    }

    if (!entry.message) {
      return [];
    }

    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const content = extractBlockText(entry.message.content);
    if (!content) {
      return [];
    }

    const transcriptEntry = createTranscriptEntry({
      entry,
      entryType: "message",
      role,
      content,
      provider: typeof entry.message.provider === "string" ? entry.message.provider : null,
      modelId: typeof entry.message.model === "string" ? entry.message.model : null,
    });
    return transcriptEntry ? [transcriptEntry] : [];
  });
}

export async function loadSessionTranscript(sessionPath) {
  const file = await readFile(sessionPath, "utf8");
  return parseSessionTranscript(file.split(/\r?\n/));
}
