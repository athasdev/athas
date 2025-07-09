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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[70vh] overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-medium text-[var(--text-color)]">Select Files for Context</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[var(--hover-color)] rounded transition-colors"
          >
            <X size={14} className="text-[var(--text-lighter)]" />
          </button>
        </div>

        <div className="p-3 max-h-[50vh] overflow-y-auto">
          {buffers.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-lighter)]">
              <FileText size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No files open</p>
            </div>
          ) : (
            <div className="space-y-2">
              {buffers.map(buffer => (
                <div
                  key={buffer.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded cursor-pointer transition-colors",
                    selectedBufferIds.has(buffer.id)
                      ? "bg-blue-500/20 border border-blue-500/30"
                      : "hover:bg-[var(--hover-color)] border border-transparent",
                  )}
                  onClick={() => onToggleBuffer(buffer.id)}
                >
                  <div
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center",
                      selectedBufferIds.has(buffer.id)
                        ? "bg-blue-500 border-blue-500"
                        : "border-[var(--border-color)]",
                    )}
                  >
                    {selectedBufferIds.has(buffer.id) && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {buffer.isSQLite ? (
                      <Database size={14} className="text-[var(--text-lighter)] flex-shrink-0" />
                    ) : (
                      <FileText size={14} className="text-[var(--text-lighter)] flex-shrink-0" />
                    )}
                    <span className="text-sm text-[var(--text-color)] truncate">{buffer.name}</span>
                    {buffer.isDirty && (
                      <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-3 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded hover:bg-[var(--hover-color)] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
