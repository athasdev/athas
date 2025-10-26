import { Database, Package, Pin } from "lucide-react";
import FileIcon from "@/file-explorer/views/file.icon";
import type { Buffer } from "@/types/buffer";

interface TabDragPreviewProps {
  x: number;
  y: number;
  buffer: Buffer;
}

const TabDragPreview = ({ x, y, buffer }: TabDragPreviewProps) => (
  <div
    className="pointer-events-none fixed z-50"
    style={{ left: x, top: y, transform: "translate(0, 0)" }}
  >
    <div className="tab-drag-preview flex items-center gap-1.5 rounded border border-border bg-primary-bg px-2 py-1 font-mono text-xs opacity-90">
      <span className="grid size-3 shrink-0 place-content-center py-3">
        {buffer.path === "extensions://marketplace" ? (
          <Package size={12} className="text-blue-500" />
        ) : buffer.isSQLite ? (
          <Database size={12} className="text-text-lighter" />
        ) : (
          <FileIcon fileName={buffer.name} isDir={false} className="text-text-lighter" size={12} />
        )}
      </span>
      {buffer.isPinned && <Pin size={8} className="flex-shrink-0 text-blue-500" />}
      <span className="max-w-[200px] truncate text-text">
        {buffer.name}
        {buffer.isDirty && <span className="ml-1 text-text-lighter">•</span>}
      </span>
    </div>
  </div>
);

export default TabDragPreview;
