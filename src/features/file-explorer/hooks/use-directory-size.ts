import { useEffect, useState } from "react";
import { getLocalDirectorySize } from "@/features/file-system/controllers/platform";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { isRemotePath } from "@/features/remote/utils/remote-path";
import { isWslPath } from "@/features/wsl/utils/wsl-path";

const MAX_CONCURRENT_DIRECTORY_SCANS = 2;
const DIRECTORY_SIZE_CACHE_DURATION = 60_000;

interface DirectorySizeJob {
  path: string;
  resolve: (size: number | null) => void;
}

interface DirectorySizeCacheEntry {
  expiresAt: number;
  result: Promise<number | null>;
}

const directorySizeCache = new Map<string, DirectorySizeCacheEntry>();
const directorySizeQueue: DirectorySizeJob[] = [];
let activeDirectoryScans = 0;

function drainDirectorySizeQueue() {
  while (activeDirectoryScans < MAX_CONCURRENT_DIRECTORY_SCANS && directorySizeQueue.length > 0) {
    const job = directorySizeQueue.shift();
    if (!job) return;

    activeDirectoryScans += 1;
    void getLocalDirectorySize(job.path)
      .then(job.resolve)
      .catch(() => job.resolve(null))
      .finally(() => {
        activeDirectoryScans -= 1;
        drainDirectorySizeQueue();
      });
  }
}

function requestDirectorySize(path: string): Promise<number | null> {
  const now = Date.now();
  const cached = directorySizeCache.get(path);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const result = new Promise<number | null>((resolve) => {
    directorySizeQueue.push({ path, resolve });
    drainDirectorySizeQueue();
  });
  directorySizeCache.set(path, {
    expiresAt: now + DIRECTORY_SIZE_CACHE_DURATION,
    result,
  });
  globalThis.setTimeout(() => {
    if (directorySizeCache.get(path)?.result === result) {
      directorySizeCache.delete(path);
    }
  }, DIRECTORY_SIZE_CACHE_DURATION);
  return result;
}

export function shouldShowDirectorySize(file: FileEntry): boolean {
  return (
    file.isDir &&
    (file.ignored === true || (file.name.startsWith(".") && file.name.length > 1)) &&
    !isRemotePath(file.path) &&
    !isWslPath(file.path)
  );
}

export function useDirectorySize(path: string, enabled: boolean): number | null {
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setSize(null);
      return;
    }

    setSize(null);
    void requestDirectorySize(path).then((nextSize) => {
      if (!cancelled) setSize(nextSize);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, path]);

  return size;
}
