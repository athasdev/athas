import { useMemo } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { resolveEditorViewCursorPosition } from "@/features/editor/utils/editor-view-cursor-position";
import { useDocumentOutline } from "@/features/outline/hooks/use-document-outline";
import { findSymbolPathAtPosition } from "@/features/outline/utils/symbol-path";
import { openOutlineSymbol } from "@/features/outline/utils/outline-symbols";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SymbolBreadcrumbProps {
  bufferId?: string;
  editorViewKey?: string | null;
  filePath: string;
  interactive?: boolean;
  className?: string;
}

export function SymbolBreadcrumb({
  bufferId,
  editorViewKey,
  filePath,
  interactive = true,
  className,
}: SymbolBreadcrumbProps) {
  const breadcrumbShowSymbols = useSettingsStore((state) => state.settings.breadcrumbShowSymbols);

  const availableExtensions = useExtensionStore.use.availableExtensions();
  const isExtensionStoreReady = availableExtensions.size > 0;

  const isLspSupported = !filePath.includes("://") && extensionRegistry.isLspSupported(filePath);
  const { symbols, isSupported } = useDocumentOutline({
    isActive: breadcrumbShowSymbols && isLspSupported,
    bufferId,
  });
  const activeEditorViewKey = useEditorStateStore.use.activeEditorViewKey();
  const activeCursorPosition = useEditorStateStore.use.cursorPosition();
  const cursorPosition = useMemo(() => {
    const cachedPosition = editorViewKey
      ? useEditorStateStore.getState().actions.getCachedPosition(editorViewKey)
      : undefined;

    return resolveEditorViewCursorPosition(
      editorViewKey,
      activeEditorViewKey,
      activeCursorPosition,
      cachedPosition,
    );
  }, [activeCursorPosition, activeEditorViewKey, editorViewKey]);

  const symbolChain = useMemo(
    () => findSymbolPathAtPosition(symbols, cursorPosition.line, cursorPosition.column),
    [symbols, cursorPosition.line, cursorPosition.column],
  );

  if (
    !isExtensionStoreReady ||
    !breadcrumbShowSymbols ||
    !isLspSupported ||
    !isSupported ||
    symbolChain.length === 0
  ) {
    return null;
  }

  return (
    <div
      className={cn("flex min-w-0 items-center gap-0.5 overflow-x-auto scrollbar-none", className)}
    >
      {symbolChain.map((symbol) => (
        <div key={symbol.id} className="flex shrink-0 items-center gap-0.5">
          <span aria-hidden="true" className="mx-0.5 shrink-0 text-text-lighter ui-text-sm">
            ›
          </span>
          {interactive ? (
            <Button
              onClick={() => openOutlineSymbol(symbol)}
              variant="ghost"
              size="xs"
              className="min-w-0 gap-1 whitespace-nowrap rounded px-1 py-0.5 text-text-lighter ui-text-sm hover:text-text"
            >
              {symbol.name}
            </Button>
          ) : (
            <span className="truncate rounded px-1 py-0.5 text-text-lighter ui-text-sm">
              {symbol.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
