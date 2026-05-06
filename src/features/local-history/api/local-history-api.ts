import { invoke as tauriInvoke } from "@tauri-apps/api/core";

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
  return tauriInvoke<LocalHistoryEntry | null>("local_history_record_file", {
    path,
    reason,
    label,
  });
};

export const listLocalHistoryFile = async (path: string): Promise<LocalHistoryEntry[]> => {
  return tauriInvoke<LocalHistoryEntry[]>("local_history_list_file", { path });
};

export const readLocalHistoryEntry = async (path: string, entryId: string): Promise<string> => {
  return tauriInvoke<string>("local_history_read_entry", {
    path,
    entryId,
  });
};

export const deleteLocalHistoryEntry = async (path: string, entryId: string): Promise<void> => {
  await tauriInvoke("local_history_delete_entry", {
    path,
    entryId,
  });
};

export const renameLocalHistoryEntry = async (
  path: string,
  entryId: string,
  label: string | null,
): Promise<LocalHistoryEntry> => {
  return tauriInvoke<LocalHistoryEntry>("local_history_rename_entry", {
    path,
    entryId,
    label,
  });
};
