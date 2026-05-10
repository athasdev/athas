import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsLeftRight,
  ClockCounterClockwise,
  Eye,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFile, writeFile } from "@/features/file-system/controllers/platform";
import {
  deleteLocalHistoryEntry,
  listLocalHistoryFile,
  readLocalHistoryEntry,
  recordLocalHistoryFile,
  renameLocalHistoryEntry,
  type LocalHistoryEntry,
} from "@/features/local-history/api/local-history-api";
import { useLocalHistoryStore } from "@/features/local-history/store/local-history-store";
import { createLocalHistoryDiff } from "@/features/local-history/utils/local-history-diff";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandHeader, CommandInput, CommandList } from "@/ui/command";
import { primitivePrompt } from "@/ui/primitive-dialog-service";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { getBaseName } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";

interface LocalHistoryCommandContentProps {
  isActive: boolean;
  activeFilePath?: string | null;
  onBack: () => void;
  onClose: () => void;
}

function formatSnapshotSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSnapshotDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getEntryTitle(entry: LocalHistoryEntry): string {
  return entry.label?.trim() || formatSnapshotDate(entry.created_at);
}

export function LocalHistoryCommandContent({
  isActive,
  activeFilePath,
  onBack,
  onClose,
}: LocalHistoryCommandContentProps) {
  const storedTargetPath = useLocalHistoryStore.use.targetPath();
  const targetPath = storedTargetPath ?? activeFilePath ?? null;
  const fileName = targetPath ? getBaseName(targetPath, "file") : "Local History";
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<LocalHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          !query.trim() ||
          matchesSearchQuery(query, [
            entry.file_name,
            entry.label ?? "",
            entry.reason,
            formatSnapshotDate(entry.created_at),
            formatRelativeDate(new Date(entry.created_at)),
          ]),
      ),
    [entries, query],
  );

  const loadEntries = useCallback(async () => {
    if (!targetPath) {
      setEntries([]);
      return;
    }

    setIsLoading(true);
    try {
      setEntries(await listLocalHistoryFile(targetPath));
    } catch (error) {
      console.error("Failed to load local history:", error);
      toast.error("Failed to load local history");
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [targetPath]);

  useEffect(() => {
    if (!isActive) return;
    setQuery("");
    setSelectedIndex(0);
    void loadEntries();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive, loadEntries]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, targetPath]);

  useEffect(() => {
    if (!listRef.current || filteredEntries.length === 0) return;
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [filteredEntries.length, selectedIndex]);

  const openSnapshot = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      try {
        const content = await readLocalHistoryEntry(targetPath, entry.id);
        const snapshotName = `${fileName} (${formatSnapshotDate(entry.created_at)})`;
        useBufferStore
          .getState()
          .actions.openBuffer(
            `local-history://${entry.id}/${encodeURIComponent(targetPath)}`,
            snapshotName,
            content,
            false,
            undefined,
            false,
            true,
          );
        onClose();
      } catch (error) {
        console.error("Failed to open local history snapshot:", error);
        toast.error("Failed to open snapshot");
      }
    },
    [fileName, onClose, targetPath],
  );

  const createSnapshot = useCallback(async () => {
    if (!targetPath) return;

    const label = await primitivePrompt("Name this local history entry:", {
      title: "Create Local History Entry",
      placeholder: "Optional name",
      confirmLabel: "Create",
    });
    if (label === null) return;

    try {
      const entry = await recordLocalHistoryFile(targetPath, "manual", label.trim() || undefined);
      if (!entry) {
        toast.info("No file changes to snapshot.");
        return;
      }
      setEntries((current) => [entry, ...current]);
      toast.success("Local history entry created");
    } catch (error) {
      console.error("Failed to create local history snapshot:", error);
      toast.error("Failed to create snapshot");
    }
  }, [targetPath]);

  const getCurrentContent = useCallback(async () => {
    if (!targetPath) return "";

    const buffer = useBufferStore
      .getState()
      .buffers.find((candidate) => candidate.type === "editor" && candidate.path === targetPath);
    if (buffer?.type === "editor") return buffer.content;

    return readFile(targetPath);
  }, [targetPath]);

  const openDiff = useCallback(
    (params: { title: string; oldContent: string; newContent: string }) => {
      if (!targetPath) return;

      if (params.oldContent === params.newContent) {
        toast.info("No changes to compare.");
        return;
      }

      const diff = createLocalHistoryDiff({
        filePath: targetPath,
        oldContent: params.oldContent,
        newContent: params.newContent,
      });

      useBufferStore
        .getState()
        .actions.openBuffer(
          `diff://local-history/${Date.now()}/${encodeURIComponent(targetPath)}`,
          params.title,
          "",
          false,
          undefined,
          true,
          true,
          diff,
        );
      onClose();
    },
    [onClose, targetPath],
  );

  const compareWithCurrent = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      try {
        const [snapshotContent, currentContent] = await Promise.all([
          readLocalHistoryEntry(targetPath, entry.id),
          getCurrentContent(),
        ]);

        openDiff({
          title: `${fileName}: ${getEntryTitle(entry)} vs Current`,
          oldContent: snapshotContent,
          newContent: currentContent,
        });
      } catch (error) {
        console.error("Failed to compare local history snapshot:", error);
        toast.error("Failed to compare snapshot");
      }
    },
    [fileName, getCurrentContent, openDiff, targetPath],
  );

  const compareWithPrevious = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      const entryIndex = entries.findIndex((candidate) => candidate.id === entry.id);
      const previousEntry = entryIndex >= 0 ? entries[entryIndex + 1] : undefined;
      if (!previousEntry) {
        toast.info("No previous local history entry.");
        return;
      }

      try {
        const [previousContent, snapshotContent] = await Promise.all([
          readLocalHistoryEntry(targetPath, previousEntry.id),
          readLocalHistoryEntry(targetPath, entry.id),
        ]);

        openDiff({
          title: `${fileName}: ${getEntryTitle(previousEntry)} vs ${getEntryTitle(entry)}`,
          oldContent: previousContent,
          newContent: snapshotContent,
        });
      } catch (error) {
        console.error("Failed to compare local history snapshots:", error);
        toast.error("Failed to compare snapshots");
      }
    },
    [entries, fileName, openDiff, targetPath],
  );

  const restoreSnapshot = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      try {
        const content = await readLocalHistoryEntry(targetPath, entry.id);
        await recordLocalHistoryFile(targetPath, "restore");
        await writeFile(targetPath, content);

        const bufferStore = useBufferStore.getState();
        const openBuffer = bufferStore.buffers.find(
          (buffer) => buffer.type === "editor" && buffer.path === targetPath,
        );
        if (openBuffer) {
          bufferStore.actions.updateBufferContent(openBuffer.id, content, false);
          bufferStore.actions.markBufferDirty(openBuffer.id, false);
        }

        window.dispatchEvent(
          new CustomEvent("git-status-updated", { detail: { filePath: targetPath } }),
        );
        toast.success("Snapshot restored");
        onClose();
      } catch (error) {
        console.error("Failed to restore local history snapshot:", error);
        toast.error("Failed to restore snapshot");
      }
    },
    [onClose, targetPath],
  );

  const deleteSnapshot = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      try {
        await deleteLocalHistoryEntry(targetPath, entry.id);
        setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
      } catch (error) {
        console.error("Failed to delete local history snapshot:", error);
        toast.error("Failed to delete snapshot");
      }
    },
    [targetPath],
  );

  const renameSnapshot = useCallback(
    async (entry: LocalHistoryEntry) => {
      if (!targetPath) return;

      const label = await primitivePrompt("Name this local history entry:", {
        title: "Rename Local History Entry",
        defaultValue: entry.label ?? "",
        placeholder: "Entry name",
        confirmLabel: "Rename",
      });
      if (label === null) return;

      try {
        const updatedEntry = await renameLocalHistoryEntry(
          targetPath,
          entry.id,
          label.trim() || null,
        );
        setEntries((current) =>
          current.map((candidate) => (candidate.id === updatedEntry.id ? updatedEntry : candidate)),
        );
      } catch (error) {
        console.error("Failed to rename local history snapshot:", error);
        toast.error("Failed to rename snapshot");
      }
    },
    [targetPath],
  );

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) =>
          current < filteredEntries.length - 1 ? current + 1 : current,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => (current > 0 ? current - 1 : current));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const entry = filteredEntries[selectedIndex];
        if (entry) void openSnapshot(entry);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filteredEntries, isActive, openSnapshot, selectedIndex]);

  return (
    <>
      <CommandHeader onClose={onClose}>
        <Button aria-label="Back" onClick={onBack} variant="ghost" className="rounded" compact>
          <ArrowLeft className="text-text-lighter" />
        </Button>
        <ClockCounterClockwise className="size-4 shrink-0 text-text-lighter" />
        <div className="min-w-0 flex-1">
          <div className="truncate ui-font ui-text-sm text-text">Local History: {fileName}</div>
          <div className="truncate ui-font ui-text-xs text-text-lighter">{targetPath}</div>
        </div>
        <Button
          aria-label="Create local history entry"
          onClick={() => void createSnapshot()}
          variant="ghost"
          compact
          className="rounded"
          tooltip="Create entry"
        >
          <Plus className="text-text-lighter" />
        </Button>
      </CommandHeader>

      <div className="border-border border-b px-4 py-2">
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Search timeline..."
        />
      </div>

      <CommandList ref={listRef}>
        {!targetPath ? (
          <CommandEmpty>No local file selected</CommandEmpty>
        ) : isLoading ? (
          <CommandEmpty>Loading timeline...</CommandEmpty>
        ) : filteredEntries.length === 0 ? (
          <CommandEmpty>No local history snapshots</CommandEmpty>
        ) : (
          filteredEntries.map((entry, index) => (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              onClick={() => void openSnapshot(entry)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "mb-1 flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-hover",
                index === selectedIndex ? "bg-selected text-text" : "bg-transparent text-text",
              )}
            >
              <ClockCounterClockwise className="size-4 shrink-0 text-text-lighter" />
              <div className="min-w-0 flex-1">
                <div className="truncate ui-font ui-text-sm text-text">{getEntryTitle(entry)}</div>
                <div className="truncate ui-font ui-text-xs text-text-lighter">
                  {formatRelativeDate(new Date(entry.created_at))} ·{" "}
                  {formatSnapshotSize(entry.size)}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="Open snapshot"
                  onClick={(event) => {
                    event.stopPropagation();
                    void openSnapshot(entry);
                  }}
                >
                  <Eye />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="Compare with current"
                  onClick={(event) => {
                    event.stopPropagation();
                    void compareWithCurrent(entry);
                  }}
                >
                  <ArrowsLeftRight />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="Compare with previous"
                  onClick={(event) => {
                    event.stopPropagation();
                    void compareWithPrevious(entry);
                  }}
                >
                  <ClockCounterClockwise />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="Restore snapshot"
                  onClick={(event) => {
                    event.stopPropagation();
                    void restoreSnapshot(entry);
                  }}
                >
                  <ArrowCounterClockwise />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  tooltip="Rename snapshot"
                  onClick={(event) => {
                    event.stopPropagation();
                    void renameSnapshot(entry);
                  }}
                >
                  <PencilSimple />
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  tooltip="Delete snapshot"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteSnapshot(entry);
                  }}
                >
                  <Trash />
                </Button>
              </div>
            </div>
          ))
        )}
      </CommandList>
    </>
  );
}
