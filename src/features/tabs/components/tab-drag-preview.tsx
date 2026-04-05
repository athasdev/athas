import { Database, Package, Pin } from "lucide-react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import type { PaneContent } from "@/features/panes/types/pane-content";

interface TabDragPreviewProps {
  x: number;
  y: number;
  buffer: PaneContent;
}

const TabDragPreview = ({ x, y, buffer }: TabDragPreviewProps) => (
  <div
    className="pointer-events-none fixed z-50"
    style={{ left: x, top: y, transform: "translate(0, 0)" }}
  >
    <div className="tab-drag-preview ui-font flex items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/95 px-2 py-1 text-xs opacity-95 shadow-sm">
      <span className="grid size-3 shrink-0 place-content-center">
        {buffer.path === "extensions://marketplace" ? (
          <Package className="text-accent" />
        ) : buffer.type === "database" ? (
          <Database className="text-text-lighter" />
        ) : (
          <FileExplorerIcon
            fileName={buffer.name}
            isDir={false}
            className="text-text-lighter"
            size={12}
          />
        )}
      </span>
      {buffer.isPinned && <Pin className="shrink-0 text-accent" />}
      <span className="max-w-[200px] truncate text-text">
        {buffer.name}
        {buffer.type === "editor" && buffer.isDirty && (
          <span className="ml-1 text-text-lighter">•</span>
        )}
      </span>
    </div>
  </div>
);

export default TabDragPreview;
