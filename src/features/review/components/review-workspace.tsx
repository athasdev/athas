import { type ReactNode, type Ref, useState } from "react";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { ReviewFileStepper } from "./review-file-stepper";

interface ReviewWorkspaceProps {
  items: FileNavigatorItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  children: ReactNode;
  isActive?: boolean;
  fileNavigation?: "embedded" | "external";
  contentRef?: Ref<HTMLDivElement>;
}

export function ReviewWorkspace({
  items,
  selectedKey,
  onSelect,
  children,
  isActive = true,
  fileNavigation = "embedded",
  contentRef,
}: ReviewWorkspaceProps) {
  const [viewMode, setViewMode] = useState<FileNavigatorViewMode>("tree");
  const hasMultipleFiles = items.length > 1;

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden bg-background">
      {fileNavigation === "embedded" && hasMultipleFiles ? (
        <FileNavigatorSidebar
          items={items}
          selectedKey={selectedKey}
          onSelect={onSelect}
          ariaLabel="Changed files"
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          surface="review"
          searchMode="fuzzy"
          compactRows
        />
      ) : null}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          ref={contentRef}
          className="h-full min-h-0 min-w-0 overflow-auto bg-background pb-24"
          style={{ overflowAnchor: "none" }}
          data-review-scroll-container
        >
          {children}
        </div>
        {hasMultipleFiles ? (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 w-fit max-w-[calc(100%-1.5rem)] -translate-x-1/2">
            <ReviewFileStepper
              items={items}
              selectedKey={selectedKey}
              onSelect={onSelect}
              isActive={isActive}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
