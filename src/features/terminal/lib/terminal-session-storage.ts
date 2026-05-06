import type { PersistedTerminal, Terminal } from "@/features/terminal/types/terminal";

const PERSISTENCE_KEY_PREFIX = "terminal-sessions";
const PERSISTENCE_ENABLED_KEY = "terminal-persistence-enabled";

export const isTerminalPersistenceEnabled = (): boolean => {
  try {
    const enabled = localStorage.getItem(PERSISTENCE_ENABLED_KEY);
    return enabled === null || enabled === "true";
  } catch {
    return true;
  }
};

export const getTerminalSessionStorageKey = (workspacePath: string): string =>
  `${PERSISTENCE_KEY_PREFIX}:${workspacePath}`;

export const serializeTerminals = (terminals: Terminal[]): PersistedTerminal[] =>
  terminals.map((terminal) => ({
    id: terminal.id,
    name: terminal.name,
    currentDirectory: terminal.currentDirectory,
    isPinned: terminal.isPinned || false,
    shell: terminal.shell,
    profileId: terminal.profileId,
    title: terminal.title,
    remoteConnectionId: terminal.remoteConnectionId,
  }));

export const dedupePersistedTerminals = (
  terminals: PersistedTerminal[] | null | undefined,
): PersistedTerminal[] => {
  const seen = new Set<string>();
  const deduped: PersistedTerminal[] = [];

  for (const terminal of terminals ?? []) {
    if (seen.has(terminal.id)) {
      continue;
    }

    seen.add(terminal.id);
    deduped.push(terminal);
  }

  return deduped;
};

export const buildTerminalRestorePayload = ({
  projectSessionTerminals,
  storageTerminals,
  preferProjectSession,
}: {
  projectSessionTerminals: PersistedTerminal[] | null | undefined;
  storageTerminals: PersistedTerminal[] | null | undefined;
  preferProjectSession: boolean;
}): PersistedTerminal[] => {
  if (preferProjectSession) {
    return dedupePersistedTerminals(projectSessionTerminals);
  }

  return dedupePersistedTerminals(storageTerminals);
};

export const loadWorkspaceTerminalsFromStorage = (
  workspacePath: string | null | undefined,
): PersistedTerminal[] => {
  if (!workspacePath || !isTerminalPersistenceEnabled()) {
    return [];
  }

  try {
    const stored = localStorage.getItem(getTerminalSessionStorageKey(workspacePath));
    if (!stored) {
      return [];
    }

    return JSON.parse(stored) as PersistedTerminal[];
  } catch (error) {
    console.error("Failed to load terminals from storage:", error);
    return [];
  }
};

export const saveWorkspaceTerminalsToStorage = (
  workspacePath: string | null | undefined,
  terminals: Terminal[],
) => {
  if (!workspacePath || !isTerminalPersistenceEnabled()) {
    return;
  }

  try {
    localStorage.setItem(
      getTerminalSessionStorageKey(workspacePath),
      JSON.stringify(serializeTerminals(terminals)),
    );
  } catch (error) {
    console.error("Failed to save terminals to storage:", error);
  }
};

export const setTerminalPersistence = (enabled: boolean) => {
  try {
    localStorage.setItem(PERSISTENCE_ENABLED_KEY, String(enabled));
    if (!enabled) {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`${PERSISTENCE_KEY_PREFIX}:`))
        .forEach((key) => localStorage.removeItem(key));
    }
  } catch (error) {
    console.error("Failed to update persistence setting:", error);
  }
};
