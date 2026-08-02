import { Fragment, useMemo } from "react";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { resolveEditorViewCursorPosition } from "@/features/editor/utils/editor-view-cursor-position";
import { useDocumentOutline } from "@/features/outline/hooks/use-document-outline";
import { findSymbolPathAtPosition } from "@/features/outline/utils/symbol-path";
import { openOutlineSymbol } from "@/features/outline/utils/outline-symbols";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/ui/breadcrumb";
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
    <Breadcrumb
      aria-label="Symbol path"
      className={cn("min-w-0 overflow-x-auto scrollbar-none", className)}
    >
      <BreadcrumbList className="flex-nowrap gap-0">
        {symbolChain.map((symbol, index) => {
          const isLast = index === symbolChain.length - 1;

          return (
            <Fragment key={symbol.id}>
              <BreadcrumbSeparator className="mx-0.5 shrink-0" />
              <BreadcrumbItem className="shrink-0 gap-0">
                {interactive ? (
                  <BreadcrumbLink
                    render={
                      <Button onClick={() => openOutlineSymbol(symbol)} variant="ghost" size="xs" />
                    }
                    className="min-w-0 whitespace-nowrap text-subtle-foreground hover:text-foreground"
                  >
                    {symbol.name}
                  </BreadcrumbLink>
                ) : isLast ? (
                  <BreadcrumbPage className="truncate px-1.5">{symbol.name}</BreadcrumbPage>
                ) : (
                  <span className="truncate px-1.5 text-subtle-foreground">{symbol.name}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
