import { ArrowsInIcon, ArrowsOutIcon, FileCodeIcon, XIcon } from "@/ui/icons";
import { useCallback, useMemo, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { ScrollArea } from "@/ui/scroll-area";
import { PaneContentHeader } from "@/features/panes/components/pane-content-chrome";
import { Button } from "@/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/ui/accordion";
import { SidebarListItem } from "@/ui/sidebar";
import { useReferencesStore } from "../stores/references.store";
import type { Reference } from "../types/reference.types";

interface ReferencesPaneProps {
  onFullScreen?: () => void;
  isFullScreen?: boolean;
}

interface ReferenceGroup {
  filePath: string;
  fileName: string;
  items: Reference[];
}

const getFileName = (filePath: string) => {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
};

const ReferencesPane = ({ onFullScreen, isFullScreen = false }: ReferencesPaneProps) => {
  const references = useReferencesStore.use.references();
  const query = useReferencesStore.use.query();
  const isLoading = useReferencesStore.use.isLoading();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const grouped = useMemo<ReferenceGroup[]>(() => {
    const byFile = new Map<string, Reference[]>();
    for (const ref of references) {
      const existing = byFile.get(ref.filePath) || [];
      existing.push(ref);
      byFile.set(ref.filePath, existing);
    }
    return Array.from(byFile.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, items]) => ({
        filePath,
        fileName: getFileName(filePath),
        items: items.sort((a, b) => a.line - b.line || a.column - b.column),
      }));
  }, [references]);

  const handleReferenceClick = useCallback(
    (ref: Reference) => {
      void handleFileSelect?.(ref.filePath, false, ref.line + 1, ref.column + 1, undefined, false);
    },
    [handleFileSelect],
  );

  return (
    <div className="flex h-full flex-col">
      <PaneContentHeader
        title="References"
        detail={`${query ? `${query.symbol} · ` : ""}${isLoading ? "Finding…" : references.length}`}
        actions={
          <>
            {onFullScreen && (
              <Button
                onClick={onFullScreen}
                tooltip={isFullScreen ? "Exit fullscreen" : "Fullscreen"}
                commandId="workbench.toggleActivePaneFullscreen"
                variant="ghost"
                iconOnly
              >
                {isFullScreen ? <ArrowsInIcon /> : <ArrowsOutIcon />}
              </Button>
            )}
            <Button
              onClick={() => useReferencesStore.getState().actions.clear()}
              tooltip="Clear references"
              variant="ghost"
              iconOnly
            >
              <XIcon />
            </Button>
          </>
        }
      />

      {/* Content */}
      <ScrollArea fill="flex">
        {isLoading ? (
          <Empty variant="inline" className="px-3 py-4">
            <EmptyDescription>
              <Spinner label="Finding references" showLabel compact />
            </EmptyDescription>
          </Empty>
        ) : references.length === 0 ? (
          <Empty variant="inline" className="px-3 py-4">
            <EmptyDescription>
              {query ? "No references found" : "Use Shift+F12 to find references"}
            </EmptyDescription>
          </Empty>
        ) : (
          <Accordion
            multiple
            value={grouped
              .filter((group) => !collapsedGroups[group.filePath])
              .map((group) => group.filePath)}
            onValueChange={(expandedPaths) => {
              setCollapsedGroups((previous) => ({
                ...previous,
                ...Object.fromEntries(
                  grouped.map((group) => [group.filePath, !expandedPaths.includes(group.filePath)]),
                ),
              }));
            }}
          >
            {grouped.map((group) => (
              <AccordionItem key={group.filePath} value={group.filePath}>
                <AccordionTrigger
                  action={<span className="pr-2 tabular-nums">{group.items.length}</span>}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <FileCodeIcon />
                    <span className="truncate">{group.fileName}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pl-5">
                  {group.items.map((ref, index) => (
                    <SidebarListItem
                      key={`${ref.filePath}:${ref.line}:${ref.column}:${index}`}
                      onClick={() => void handleReferenceClick(ref)}
                      leading={<span className="tabular-nums">{ref.line + 1}</span>}
                    >
                      {ref.lineContent.trim()}
                    </SidebarListItem>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </ScrollArea>
    </div>
  );
};

export default ReferencesPane;
