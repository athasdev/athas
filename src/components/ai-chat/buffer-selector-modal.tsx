import { Database, FileText, X } from "lucide-react";
import { cn } from "../../utils/cn";
import type { BufferSelectorModalProps } from "./types";

export default function BufferSelectorModal({
  isOpen,
  onClose,
  buffers,
  selectedBufferIds,
  onToggleBuffer,
}: BufferSelectorModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="mx-4 max-h-[70vh] w-full max-w-md overflow-hidden rounded-lg border border-border bg-primary-bg shadow-xl">
        <div className="flex items-center justify-between border-border border-b p-3">
          <h3 className="font-medium text-sm text-text">Select Files for Context</h3>
          <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-hover">
            <X size={14} className="text-text-lighter" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-3">
          {buffers.length === 0 ? (
            <div className="py-8 text-center text-text-lighter">
              <FileText size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No files open</p>
            </div>
          ) : (
            <div className="space-y-2">
              {buffers.map(buffer => (
                <div
                  key={buffer.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded p-2 transition-colors",
                    selectedBufferIds.has(buffer.id)
                      ? "border border-blue-500/30 bg-blue-500/20"
                      : "border border-transparent hover:bg-hover",
                  )}
                  onClick={() => onToggleBuffer(buffer.id)}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      selectedBufferIds.has(buffer.id)
                        ? "border-blue-500 bg-blue-500"
                        : "border-border",
                    )}
                  >
                    {selectedBufferIds.has(buffer.id) && (
                      <div className="h-2 w-2 rounded-full bg-white" />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {buffer.isSQLite ? (
                      <Database size={14} className="flex-shrink-0 text-text-lighter" />
                    ) : (
                      <FileText size={14} className="flex-shrink-0 text-text-lighter" />
                    )}
                    <span className="truncate text-sm text-text">{buffer.name}</span>
                    {buffer.isDirty && (
                      <div className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-border border-t p-3">
          <button
            onClick={onClose}
            className="rounded border border-border bg-secondary-bg px-3 py-1 text-sm transition-colors hover:bg-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
