import { readFile } from "node:fs/promises";

const normalizeText = (value) => value.replace(/\s+/g, " ").trim();

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

    if (entry?.type !== "message" || !entry.message) {
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

    const timestamp =
      typeof entry.timestamp === "string"
        ? entry.timestamp
        : typeof entry.message.timestamp === "number"
          ? new Date(entry.message.timestamp).toISOString()
          : null;
    if (!timestamp) {
      return [];
    }

    return [
      {
        id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
        role,
        content,
        timestamp,
      },
    ];
  });
}

export async function loadSessionTranscript(sessionPath) {
  const file = await readFile(sessionPath, "utf8");
  return parseSessionTranscript(file.split(/\r?\n/));
}
