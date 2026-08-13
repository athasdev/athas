import type { ReactNode, RefObject } from "react";
import { ScrollArea } from "@/ui/scroll-area";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "./file-navigator-sidebar";

interface FileResultsWorkspaceProps {
  children: ReactNode;
  items: FileNavigatorItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  ariaLabel: string;
  viewMode: FileNavigatorViewMode;
  onViewModeChange: (viewMode: FileNavigatorViewMode) => void;
  showNavigator?: boolean;
  navigatorSearchResetKey?: string;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  orientation?: "vertical" | "both";
}

export function FileResultsWorkspace({
  children,
  items,
  selectedKey,
  onSelect,
  ariaLabel,
  viewMode,
  onViewModeChange,
  showNavigator = true,
  navigatorSearchResetKey,
  scrollContainerRef,
  orientation = "vertical",
}: FileResultsWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-background">
      {showNavigator && items.length > 0 ? (
        <FileNavigatorSidebar
          items={items}
          selectedKey={selectedKey}
          onSelect={onSelect}
          ariaLabel={ariaLabel}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          surface="inset"
          searchMode="fuzzy"
          compactRows
          searchResetKey={navigatorSearchResetKey}
          className="my-2 ml-2 h-auto self-stretch"
        />
      ) : null}

      <ScrollArea
        className="min-h-0 min-w-0 flex-1 bg-background"
        contentClassName="min-h-full px-2 pb-2"
        orientation={orientation}
        viewportProps={
          scrollContainerRef
            ? {
                ref: scrollContainerRef,
                style: { overflowAnchor: "none" },
              }
            : undefined
        }
      >
        {children}
      </ScrollArea>
    </div>
  );
}
