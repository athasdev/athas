import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ensureAssetAccess, hasSettledAssetAccess } from "@/utils/asset-access";

/** Returns an `asset:` URL for `path` once the native side has allowed it. */
export function useAssetUrl(path: string | null): string | null {
  const [readyPath, setReadyPath] = useState<string | null>(null);
  const isReady = path !== null && (readyPath === path || hasSettledAssetAccess(path));

  useEffect(() => {
    if (path === null || hasSettledAssetAccess(path)) return;
    let cancelled = false;
    void ensureAssetAccess(path).then(() => {
      if (!cancelled) setReadyPath(path);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return isReady ? convertFileSrc(path) : null;
}
