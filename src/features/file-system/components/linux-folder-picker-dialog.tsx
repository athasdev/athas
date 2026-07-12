import { homeDir } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import {
  ArrowUpIcon as ArrowUp,
  FolderIcon as Folder,
  HouseIcon as House,
  WarningIcon as Warning,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLinuxFolderPickerStore } from "@/features/file-system/stores/linux-folder-picker.store";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { IS_LINUX } from "@/utils/platform";

interface FolderEntry {
  name: string;
  path: string;
}

function normalizeLinuxPath(path: string, fallbackHome: string): string {
  const trimmed = path.trim();

  if (!trimmed || trimmed === "~") return fallbackHome || "/";
  if (trimmed.startsWith("~/")) return `${fallbackHome.replace(/\/+$/, "")}/${trimmed.slice(2)}`;
  if (trimmed.startsWith("/")) return trimmed.replace(/\/+$/, "") || "/";

  return `/${trimmed}`.replace(/\/+$/, "") || "/";
}

function parentPath(path: string): string {
  if (path === "/") return "/";

  const trimmed = path.replace(/\/+$/, "");
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/"));
  return parent || "/";
}

function joinPath(parent: string, child: string): string {
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

export default function LinuxFolderPickerDialog() {
  const isOpen = useLinuxFolderPickerStore.use.isOpen();
  const initialPath = useLinuxFolderPickerStore.use.initialPath();
  const { resolve } = useLinuxFolderPickerStore.use.actions();
  const [homePath, setHomePath] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canGoUp = currentPath !== "/";

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const directoryEntries = await readDir(path);
      const folders = directoryEntries
        .filter((entry) => entry.isDirectory && entry.name)
        .map((entry) => ({
          name: entry.name,
          path: joinPath(path, entry.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

      setEntries(folders);
    } catch (loadError) {
      setEntries([]);
      setError("Unable to read this folder.");
      console.error("Failed to read folder:", path, loadError);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const navigateToPath = useCallback(
    (nextPath: string) => {
      const normalizedPath = normalizeLinuxPath(nextPath, homePath);
      setCurrentPath(normalizedPath);
      setPathInput(normalizedPath);
      void loadDirectory(normalizedPath);
    },
    [homePath, loadDirectory],
  );

  useEffect(() => {
    if (!isOpen || !IS_LINUX) return;

    let cancelled = false;

    const initialize = async () => {
      const detectedHome = await homeDir().catch(() => "/");
      if (cancelled) return;

      const nextHomePath = detectedHome || "/";
      const startPath = normalizeLinuxPath(initialPath || nextHomePath, nextHomePath);

      setHomePath(nextHomePath);
      setCurrentPath(startPath);
      setPathInput(startPath);
      await loadDirectory(startPath);
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [initialPath, isOpen, loadDirectory]);

  const title = useMemo(() => {
    if (currentPath === "/") return "/";
    const segments = currentPath.split("/").filter(Boolean);
    return segments[segments.length - 1] || currentPath;
  }, [currentPath]);

  const handleOpen = () => {
    if (error) {
      toast.error("Choose a readable folder.");
      return;
    }

    resolve(currentPath);
  };

  if (!IS_LINUX || !isOpen) return null;

  return (
    <Dialog
      title="Open Folder"
      onClose={() => resolve(null)}
      size="lg"
      headerBorder={false}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => resolve(null)}>
            Cancel
          </Button>
          <Button type="button" variant="accent" onClick={handleOpen} compact>
            Open Folder
          </Button>
        </>
      }
      classNames={{
        modal: "max-w-[640px] rounded-xl",
        content: "p-0",
      }}
    >
      <div className="border-border border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigateToPath(homePath)}
            tooltip="Home"
            aria-label="Home"
          >
            <House />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigateToPath(parentPath(currentPath))}
            disabled={!canGoUp}
            tooltip="Parent folder"
            aria-label="Parent folder"
          >
            <ArrowUp />
          </Button>
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              navigateToPath(pathInput);
            }}
          >
            <Input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              aria-label="Folder path"
              spellCheck={false}
              className="font-mono"
            />
            <Button type="submit" variant="default" compact>
              Go
            </Button>
          </form>
        </div>
      </div>

      <div className="flex min-h-[300px] flex-col">
        <div className="flex min-h-8 items-center border-border border-b px-3">
          <span className="ui-text-sm truncate font-medium text-text">{title}</span>
          <span className="ui-text-sm ml-auto truncate font-mono text-text-lighter">
            {currentPath}
          </span>
        </div>

        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <Warning className="text-warning" size={24} />
            <div className="ui-text-sm text-text">{error}</div>
            <div className="ui-text-sm text-text-lighter">{currentPath}</div>
          </div>
        ) : isLoading ? (
          <div className="ui-text-sm flex flex-1 items-center justify-center text-text-lighter">
            <LoadingIndicator label="Loading folders" showLabel compact />
          </div>
        ) : entries.length === 0 ? (
          <div className="ui-text-sm flex flex-1 items-center justify-center text-text-lighter">
            No folders
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto py-1">
            {entries.map((entry) => (
              <Button
                key={entry.path}
                type="button"
                variant="ghost"
                onClick={() => navigateToPath(entry.path)}
                className={cn(
                  "h-8 w-full justify-start gap-2 rounded-none px-3",
                  "hover:bg-hover focus-visible:bg-hover",
                )}
              >
                <Folder className="shrink-0 text-text-lighter" />
                <span className="truncate text-text">{entry.name}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
