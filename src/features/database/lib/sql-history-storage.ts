import type { DatabaseType } from "../types/provider.types";
import { getSqlHistoryEntryKey, SQL_HISTORY_LIMIT } from "./sql-history";

type SqlHistoryMode = "file" | "connection";

const SQL_HISTORY_STORAGE_PREFIX = "athas:database:sql-history:v1";

export function getSqlHistoryStorageKey(
  dbType: DatabaseType,
  mode: SqlHistoryMode,
  connectionKey: string,
): string {
  return `${SQL_HISTORY_STORAGE_PREFIX}:${dbType}:${mode}:${connectionKey}`;
}

function getSqlHistoryStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeSqlHistory(history: unknown): string[] {
  if (!Array.isArray(history)) return [];

  const seen = new Set<string>();

  return history
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      const key = getSqlHistoryEntryKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SQL_HISTORY_LIMIT);
}

export function loadSqlHistory(
  dbType: DatabaseType,
  mode: SqlHistoryMode,
  connectionKey: string,
): string[] {
  const storage = getSqlHistoryStorage();
  if (!storage) return [];

  try {
    const rawHistory = storage.getItem(getSqlHistoryStorageKey(dbType, mode, connectionKey));
    if (!rawHistory) return [];

    const parsedHistory = JSON.parse(rawHistory);
    return normalizeSqlHistory(parsedHistory);
  } catch {
    return [];
  }
}

export function saveSqlHistory(
  dbType: DatabaseType,
  mode: SqlHistoryMode,
  connectionKey: string,
  history: string[],
): void {
  const storage = getSqlHistoryStorage();
  if (!storage) return;

  const storageKey = getSqlHistoryStorageKey(dbType, mode, connectionKey);

  try {
    const normalizedHistory = normalizeSqlHistory(history);

    if (normalizedHistory.length === 0) {
      storage.removeItem(storageKey);
      return;
    }

    storage.setItem(storageKey, JSON.stringify(normalizedHistory));
  } catch {
    // Ignore local storage quota or permission failures; history should never block queries.
  }
}
