const INSTALLED_LANGUAGES_KEY = "athas.installedLanguages";
/** The tree-sitter parser cache that used to record installed language integrations. */
const LEGACY_PARSER_CACHE_DB = "athas-parser-cache";
const LEGACY_PARSER_CACHE_STORE = "parsers";

export interface InstalledLanguage {
  languageId: string;
  extensionId?: string;
  version: string;
  installedAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readEntries(): InstalledLanguage[] {
  if (!canUseStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(INSTALLED_LANGUAGES_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is InstalledLanguage =>
        typeof entry?.languageId === "string" && typeof entry?.version === "string",
    );
  } catch {
    return [];
  }
}

function writeEntries(entries: InstalledLanguage[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(INSTALLED_LANGUAGES_KEY, JSON.stringify(entries));
}

let migration: Promise<void> | null = null;

/**
 * Installs used to be recorded by the parsers they downloaded into IndexedDB. Highlighting no
 * longer needs those parsers, so the installed languages move to this list once and the cache,
 * with its stored WebAssembly, is deleted.
 */
function migrateLegacyParserCache(): Promise<void> {
  migration ??= (async () => {
    if (typeof indexedDB === "undefined") return;
    const legacyEntries = await readLegacyParserCache();
    if (legacyEntries.length > 0) {
      const entries = readEntries();
      const known = new Set(entries.map((entry) => entry.languageId));
      for (const legacy of legacyEntries) {
        if (!known.has(legacy.languageId)) entries.push(legacy);
      }
      writeEntries(entries);
    }
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(LEGACY_PARSER_CACHE_DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  })().catch((error: unknown) => {
    console.warn("Failed to migrate installed language integrations:", error);
  });
  return migration;
}

function readLegacyParserCache(): Promise<InstalledLanguage[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_PARSER_CACHE_DB);
    request.onerror = () => resolve([]);
    request.onupgradeneeded = () => {
      // The database did not exist; opening it created an empty one, which is deleted next.
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_PARSER_CACHE_STORE)) {
        db.close();
        resolve([]);
        return;
      }
      const all = db
        .transaction(LEGACY_PARSER_CACHE_STORE, "readonly")
        .objectStore(LEGACY_PARSER_CACHE_STORE)
        .getAll();
      all.onerror = () => {
        db.close();
        resolve([]);
      };
      all.onsuccess = () => {
        db.close();
        const rows = Array.isArray(all.result) ? all.result : [];
        resolve(
          rows
            .filter((row) => typeof row?.languageId === "string")
            .map((row) => ({
              languageId: row.languageId,
              extensionId: typeof row.extensionId === "string" ? row.extensionId : undefined,
              version: typeof row.version === "string" ? row.version : "0.0.0",
              installedAt: typeof row.downloadedAt === "number" ? row.downloadedAt : Date.now(),
            })),
        );
      };
    };
  });
}

/** The language integrations the user installed. */
export const installedLanguages = {
  async list(): Promise<InstalledLanguage[]> {
    await migrateLegacyParserCache();
    return readEntries();
  },

  async add(entry: Omit<InstalledLanguage, "installedAt">): Promise<void> {
    await migrateLegacyParserCache();
    const entries = readEntries().filter((existing) => existing.languageId !== entry.languageId);
    entries.push({ ...entry, installedAt: Date.now() });
    writeEntries(entries);
  },

  async uninstall(languageId: string): Promise<void> {
    await migrateLegacyParserCache();
    writeEntries(readEntries().filter((entry) => entry.languageId !== languageId));
  },
};
