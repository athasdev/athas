import { useCallback, useEffect, useMemo, useState } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { normalizeOutlineSymbols } from "../utils/outline-symbols";

const OUTLINE_REFRESH_DELAY_MS = 250;

export function useDocumentOutline(isActive = true) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId) ?? null;
  const filePath = activeBuffer?.path ?? "";
  const contentVersion = activeBuffer && hasTextContent(activeBuffer) ? activeBuffer.content : "";
  const isSupported =
    Boolean(filePath) &&
    activeBuffer?.type === "editor" &&
    !activeBuffer.isVirtual &&
    extensionRegistry.isLspSupported(filePath);
  const [rawSymbols, setRawSymbols] = useState<
    Awaited<ReturnType<LspClient["getDocumentSymbols"]>>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isActive || !isSupported || !filePath) {
      setRawSymbols([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await LspClient.getInstance().getDocumentSymbols(filePath);
      setRawSymbols(result);
    } catch {
      setRawSymbols([]);
    } finally {
      setIsLoading(false);
    }
  }, [filePath, isActive, isSupported]);

  useEffect(() => {
    if (!isActive) return;
    const timeout = window.setTimeout(() => {
      void refresh();
    }, OUTLINE_REFRESH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [contentVersion, isActive, refresh]);

  const symbols = useMemo(
    () => normalizeOutlineSymbols(rawSymbols, filePath),
    [filePath, rawSymbols],
  );

  return {
    activeBuffer,
    filePath,
    symbols,
    isLoading,
    isSupported,
    refresh,
  };
}
