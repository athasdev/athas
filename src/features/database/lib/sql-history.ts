export const SQL_HISTORY_LIMIT = 10;
const SQL_HISTORY_PREVIEW_LIMIT = 96;

function normalizeSqlHistoryText(query: string): string {
  return query
    .trim()
    .replace(/(?:\s*;)+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function stripLeadingSqlComments(query: string): string {
  let remaining = query.trimStart();

  while (remaining.length > 0) {
    if (remaining.startsWith("--")) {
      const lineEnd = remaining.indexOf("\n");
      if (lineEnd === -1) return "";
      remaining = remaining.slice(lineEnd + 1).trimStart();
      continue;
    }

    if (remaining.startsWith("#")) {
      const lineEnd = remaining.indexOf("\n");
      if (lineEnd === -1) return "";
      remaining = remaining.slice(lineEnd + 1).trimStart();
      continue;
    }

    if (remaining.startsWith("/*")) {
      const commentEnd = remaining.indexOf("*/", 2);
      if (commentEnd === -1) return remaining;
      remaining = remaining.slice(commentEnd + 2).trimStart();
      continue;
    }

    break;
  }

  return remaining;
}

export function getSqlHistoryEntryKey(query: string): string {
  return normalizeSqlHistoryText(stripLeadingSqlComments(query) || query);
}

export function addSqlHistoryEntry(history: string[], query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return history;
  const normalizedKey = getSqlHistoryEntryKey(normalizedQuery);

  return [
    normalizedQuery,
    ...history.filter((entry) => getSqlHistoryEntryKey(entry) !== normalizedKey),
  ].slice(0, SQL_HISTORY_LIMIT);
}

export function removeSqlHistoryEntry(history: string[], query: string): string[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return history;
  const normalizedKey = getSqlHistoryEntryKey(normalizedQuery);
  return history.filter((entry) => getSqlHistoryEntryKey(entry) !== normalizedKey);
}

export function useSqlHistoryEntry(history: string[], query: string): string[] {
  const normalizedQuery = query.trim();
  const normalizedKey = getSqlHistoryEntryKey(normalizedQuery);
  if (
    !normalizedQuery ||
    !history.some((entry) => getSqlHistoryEntryKey(entry) === normalizedKey)
  ) {
    return history;
  }
  return addSqlHistoryEntry(removeSqlHistoryEntry(history, normalizedQuery), normalizedQuery);
}

export function formatSqlHistoryPreview(query: string): string {
  const preview = getSqlHistoryEntryKey(query);
  if (preview.length <= SQL_HISTORY_PREVIEW_LIMIT) return preview;
  const truncated = preview.slice(0, SQL_HISTORY_PREVIEW_LIMIT - 1);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  if (lastSpaceIndex <= 0) return `${truncated}…`;
  return `${truncated.slice(0, lastSpaceIndex)}…`;
}
