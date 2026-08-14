import type { ReactNode, RefObject } from "react";
import { ScrollArea } from "@/ui/scroll-area";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "./file-navigator-sidebar";
import { cn } from "@/utils/cn";

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
  navigatorPosition?: "left" | "right";
  navigatorResponsiveOverlay?: boolean;
  navigatorAppearance?: "inset" | "panel";
  contentInset?: boolean;
  scrollbarVisibility?: "hover" | "always";
  reserveScrollbarGutter?: boolean;
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
  navigatorPosition = "left",
  navigatorResponsiveOverlay = false,
  navigatorAppearance = "inset",
  contentInset = true,
  scrollbarVisibility = "hover",
  reserveScrollbarGutter = false,
}: FileResultsWorkspaceProps) {
  const navigator =
    showNavigator && items.length > 0 ? (
      <FileNavigatorSidebar
        items={items}
        selectedKey={selectedKey}
        onSelect={onSelect}
        ariaLabel={ariaLabel}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        surface={navigatorAppearance}
        searchMode="fuzzy"
        compactRows={navigatorAppearance !== "panel"}
        searchResetKey={navigatorSearchResetKey}
        resizeEdge={navigatorPosition === "left" ? "right" : "left"}
        className={cn(
          "z-20 h-auto self-stretch",
          navigatorAppearance === "inset" && "my-2",
          navigatorAppearance === "inset" && (navigatorPosition === "left" ? "ml-2" : "mr-2"),
          navigatorResponsiveOverlay &&
            navigatorPosition === "right" &&
            "@max-[720px]/file-results:absolute @max-[720px]/file-results:inset-y-0 @max-[720px]/file-results:right-0 @max-[720px]/file-results:shadow-xl",
        )}
      />
    ) : null;

  return (
    <div className="@container/file-results relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background">
      {navigatorPosition === "left" ? navigator : null}

      <ScrollArea
        className="min-h-0 min-w-0 flex-1 bg-background"
        contentClassName={cn("min-h-full", contentInset && "px-2 pb-2")}
        orientation={orientation}
        reserveScrollbarGutter={reserveScrollbarGutter}
        scrollbarVisibility={scrollbarVisibility}
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

      {navigatorPosition === "right" ? navigator : null}
    </div>
  );
}
