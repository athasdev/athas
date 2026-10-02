import { commands } from "@/bindings/commands";

export interface LocalHistoryEntry {
  id: string;
  file_path: string;
  file_name: string;
  created_at: number;
  size: number;
  content_hash: string;
  reason: string;
  label?: string | null;
}

export const recordLocalHistoryFile = async (
  path: string,
  reason: "save" | "auto-save" | "restore" | "manual" = "save",
  label?: string,
): Promise<LocalHistoryEntry | null> => {
  return commands.localHistoryRecordFile(path, reason, label ?? null);
};

export const listLocalHistoryFile = async (path: string): Promise<LocalHistoryEntry[]> => {
  return commands.localHistoryListFile(path);
};

export const readLocalHistoryEntry = async (path: string, entryId: string): Promise<string> => {
  return commands.localHistoryReadEntry(path, entryId);
};

export const deleteLocalHistoryEntry = async (path: string, entryId: string): Promise<void> => {
  await commands.localHistoryDeleteEntry(path, entryId);
};

export const renameLocalHistoryEntry = async (
  path: string,
  entryId: string,
  label: string | null,
): Promise<LocalHistoryEntry> => {
  return commands.localHistoryRenameEntry(path, entryId, label);
};
