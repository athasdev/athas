import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { LspClient } from "@/features/editor/lsp/lsp-client";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { hasTextContent } from "@/features/panes/types/pane-content.types";
import { normalizeOutlineSymbols } from "../utils/outline-symbols";

const OUTLINE_REFRESH_DELAY_MS = 250;

/** The last symbols seen per file, so a remounted outline or breadcrumb starts filled. */
const outlineSymbolCache = new Map<string, Awaited<ReturnType<LspClient["getDocumentSymbols"]>>>();

export function useDocumentOutline({
  isActive = true,
  bufferId,
}: { isActive?: boolean; bufferId?: string } = {}) {
  // Metadata only: selecting the content re-rendered every outline consumer on each keystroke.
  // Content changes are followed through a store subscription below instead.
  const activeBuffer = useBufferStore(
    useShallow((state) => {
      const targetBufferId = bufferId ?? state.activeBufferId;
      const buffer = targetBufferId ? getBufferById(state.buffers, targetBufferId) : undefined;
      if (!buffer) return null;
      return {
        id: buffer.id,
        path: buffer.path,
        type: buffer.type,
        isVirtual: buffer.type === "editor" ? buffer.isVirtual : false,
      };
    }),
  );
  const filePath = activeBuffer?.path ?? "";
  const isSupported =
    Boolean(filePath) &&
    activeBuffer?.type === "editor" &&
    !activeBuffer.isVirtual &&
    extensionRegistry.isLspSupported(filePath);
  const [rawSymbols, setRawSymbols] = useState<
    Awaited<ReturnType<LspClient["getDocumentSymbols"]>>
  >(() => (filePath ? (outlineSymbolCache.get(filePath) ?? []) : []));
  const [isLoading, setIsLoading] = useState(false);
  const [symbolsFilePath, setSymbolsFilePath] = useState(filePath);
  if (symbolsFilePath !== filePath) {
    setSymbolsFilePath(filePath);
    setRawSymbols(filePath ? (outlineSymbolCache.get(filePath) ?? []) : []);
  }

  const refresh = useCallback(async () => {
    if (!isActive || !isSupported || !filePath) {
      setRawSymbols([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await LspClient.getInstance().getDocumentSymbols(filePath);
      outlineSymbolCache.set(filePath, result);
      setRawSymbols(result);
    } catch {
      setRawSymbols([]);
    } finally {
      setIsLoading(false);
    }
  }, [filePath, isActive, isSupported]);

  const activeBufferId = activeBuffer?.id;
  useEffect(() => {
    if (!isActive) return;
    let timeout: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => void refresh(), delay);
    };
    // Load straight away when nothing is cached; after that, refresh once typing pauses.
    schedule(filePath && outlineSymbolCache.has(filePath) ? OUTLINE_REFRESH_DELAY_MS : 0);
    const unsubscribe = useBufferStore.subscribe((state, previous) => {
      if (!activeBufferId) return;
      const next = getBufferById(state.buffers, activeBufferId);
      const before = getBufferById(previous.buffers, activeBufferId);
      if (!next || !before || !hasTextContent(next) || !hasTextContent(before)) return;
      if (next.content !== before.content) schedule(OUTLINE_REFRESH_DELAY_MS);
    });

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [activeBufferId, filePath, isActive, refresh]);

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
