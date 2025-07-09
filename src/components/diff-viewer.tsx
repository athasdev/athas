import {
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  FileIcon,
  FilePlus,
  FileX,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { useState } from "react";
import type { GitDiff, GitDiffLine } from "../utils/git";

interface DiffViewerProps {
  diff: GitDiff | null;
  onClose: () => void;
  fileName?: string;
  onStageHunk?: (lines: GitDiffLine[]) => void;
  onUnstageHunk?: (lines: GitDiffLine[]) => void;
  onStageLine?: (line: GitDiffLine) => void;
  onUnstageLine?: (line: GitDiffLine) => void;
}

const DiffViewer = ({
  diff,
  onClose,
  fileName,
  onStageHunk,
  onUnstageHunk,
  onStageLine,
  onUnstageLine,
}: DiffViewerProps) => {
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [zoom, setZoom] = useState<number>(1);

  if (!diff) {
    return (
      <div className="flex flex-col h-full bg-[var(--primary-bg)]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
          <h3 className="text-sm font-medium text-[var(--text-color)]">Diff Viewer</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[var(--text-lighter)] text-sm">No diff to display</p>
        </div>
      </div>
    );
  }

  // --- IMAGE DIFF HANDLING ---
  if (diff.is_image) {
    const fileLabel = fileName || diff.file_path.split("/").pop();
    const ext = fileLabel?.split(".").pop()?.toUpperCase() || "";
    const leftLabel = diff.is_deleted ? "Deleted Version" : "Previous Version";
    const rightLabel = diff.is_new ? "Added Version" : "New Version";
    const containerBase = "flex flex-col items-center justify-center p-4";
    const badge = (text: string, color: string) => (
      <span className={`ml-2 px-2 py-0.5 text-xs font-bold rounded ${color}`}>{text}</span>
    );

    // Compose image src
    const getImgSrc = (base64: string | undefined) =>
      base64 ? `data:image/*;base64,${base64}` : undefined;

    return (
      <div className="flex flex-col h-full bg-[var(--primary-bg)] select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
          <div className="flex items-center gap-2">
            {diff.is_new ? (
              <FilePlus size={14} className="text-green-500" />
            ) : diff.is_deleted ? (
              <FileX size={14} className="text-red-500" />
            ) : (
              <FileIcon size={14} className="text-[var(--text-color)]" />
            )}
            <span className="font-mono text-xs text-[var(--text-color)]">
              {fileLabel} {ext && <>• {ext}</>}
            </span>
            {diff.is_new && badge("ADDED", "bg-green-600 text-white")}
            {diff.is_deleted && badge("DELETED", "bg-red-600 text-white")}
            {!diff.is_new && !diff.is_deleted && badge("MODIFIED", "bg-blue-600 text-white")}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom(z => Math.max(0.1, z - 0.1))}
              className="p-1 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
              title="Zoom out"
            >
              -
            </button>
            <span className="font-mono text-xs text-[var(--text-lighter)] px-2 min-w-[50px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(3, z + 0.1))}
              className="p-1 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
              title="Reset zoom"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1 ml-2"
              title="Close diff viewer"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {/* Image Diff Content */}
        <div className="flex-1 flex items-center justify-center gap-8 bg-[var(--editor-bg)] overflow-auto">
          {/* Side-by-side for modified, single for added/deleted */}
          {diff.is_new && !diff.old_blob_base64 ? (
            // Added
            <div className={containerBase}>
              <span className="text-xs font-mono text-green-600 mb-2">{rightLabel}</span>
              {diff.new_blob_base64 ? (
                <img
                  src={getImgSrc(diff.new_blob_base64)}
                  alt="Added"
                  style={{
                    transform: `scale(${zoom})`,
                    transition: "transform 0.1s ease-out",
                  }}
                  draggable={false}
                />
              ) : (
                <div className="p-8 text-xs text-[var(--text-lighter)]">No image data</div>
              )}
            </div>
          ) : diff.is_deleted && !diff.new_blob_base64 ? (
            // Deleted
            <div className={containerBase}>
              <span className="text-xs font-mono text-red-600 mb-2">{leftLabel}</span>
              {diff.old_blob_base64 ? (
                <img
                  src={getImgSrc(diff.old_blob_base64)}
                  alt="Deleted"
                  style={{
                    transform: `scale(${zoom})`,
                    transition: "transform 0.1s ease-out",
                  }}
                  draggable={false}
                />
              ) : (
                <div className="p-8 text-xs text-[var(--text-lighter)]">No image data</div>
              )}
            </div>
          ) : (
            // Modified (side-by-side)
            <>
              <div className={containerBase}>
                <span className="text-xs font-mono text-[var(--text-lighter)] mb-2">
                  {leftLabel}
                </span>
                {diff.old_blob_base64 ? (
                  <img
                    src={getImgSrc(diff.old_blob_base64)}
                    alt="Previous"
                    style={{
                      transform: `scale(${zoom})`,
                      transition: "transform 0.1s ease-out",
                    }}
                    draggable={false}
                  />
                ) : (
                  <div className="p-8 text-xs text-[var(--text-lighter)]">No image data</div>
                )}
              </div>
              <div className={containerBase}>
                <span className="text-xs font-mono text-[var(--text-lighter)] mb-2">
                  {rightLabel}
                </span>
                {diff.new_blob_base64 ? (
                  <img
                    src={getImgSrc(diff.new_blob_base64)}
                    alt="New"
                    style={{
                      transform: `scale(${zoom})`,
                      transition: "transform 0.1s ease-out",
                    }}
                    draggable={false}
                  />
                ) : (
                  <div className="p-8 text-xs text-[var(--text-lighter)]">No image data</div>
                )}
              </div>
            </>
          )}
        </div>
        {/* Footer/Info */}
        <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--secondary-bg)] flex items-center gap-4 text-xs text-[var(--text-lighter)]">
          <span>Zoom: {Math.round(zoom * 100)}%</span>
          <span>Type: {ext}</span>
          <span>Use +/- buttons to zoom in/out</span>
        </div>
      </div>
    );
  }

  const getFileIcon = () => {
    if (diff.is_new) return <FilePlus size={14} className="text-green-500" />;
    if (diff.is_deleted) return <FileX size={14} className="text-red-500" />;
    if (diff.is_renamed) return <Edit3 size={14} className="text-blue-500" />;
    return <FileIcon size={14} className="text-[var(--text-color)]" />;
  };

  const getFileStatus = () => {
    if (diff.is_new) return "Added";
    if (diff.is_deleted) return "Deleted";
    if (diff.is_renamed) return "Renamed";
    return "Modified";
  };

  const groupLinesIntoHunks = (lines: GitDiffLine[]) => {
    const hunks: { header: GitDiffLine; lines: GitDiffLine[]; id: number }[] = [];
    let currentHunk: GitDiffLine[] = [];
    let currentHeader: GitDiffLine | null = null;
    let hunkId = 0;

    lines.forEach(line => {
      if (line.line_type === "header") {
        if (currentHeader && currentHunk.length > 0) {
          hunks.push({ header: currentHeader, lines: [...currentHunk], id: hunkId++ });
        }
        currentHeader = line;
        currentHunk = [];
      } else if (currentHeader) {
        currentHunk.push(line);
      }
    });

    if (currentHeader && currentHunk.length > 0) {
      hunks.push({ header: currentHeader, lines: [...currentHunk], id: hunkId });
    }

    return hunks;
  };

  const toggleHunkCollapse = (hunkId: number) => {
    const newCollapsed = new Set(collapsedHunks);
    if (newCollapsed.has(hunkId)) {
      newCollapsed.delete(hunkId);
    } else {
      newCollapsed.add(hunkId);
    }
    setCollapsedHunks(newCollapsed);
  };

  const copyLineContent = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const renderHunkHeader = (hunk: { header: GitDiffLine; lines: GitDiffLine[]; id: number }) => {
    const isCollapsed = collapsedHunks.has(hunk.id);
    const addedCount = hunk.lines.filter(l => l.line_type === "added").length;
    const removedCount = hunk.lines.filter(l => l.line_type === "removed").length;

    return (
      <div className="bg-[var(--secondary-bg)] border-y border-[var(--border-color)] sticky top-0 z-10">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleHunkCollapse(hunk.id)}
              className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
            <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
              {hunk.header.content}
            </span>
            <div className="flex items-center gap-2 text-xs">
              {removedCount > 0 && (
                <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                  -{removedCount}
                </span>
              )}
              {addedCount > 0 && (
                <span className="text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                  +{addedCount}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {(onStageHunk || onUnstageHunk) && (
              <>
                {onStageHunk && (
                  <button
                    onClick={() => onStageHunk(hunk.lines)}
                    className="text-xs px-2 py-1 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded transition-colors flex items-center gap-1"
                    title="Stage hunk"
                  >
                    <Plus size={10} />
                    Stage
                  </button>
                )}
                {onUnstageHunk && (
                  <button
                    onClick={() => onUnstageHunk(hunk.lines)}
                    className="text-xs px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-colors flex items-center gap-1"
                    title="Unstage hunk"
                  >
                    <Minus size={10} />
                    Unstage
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => copyLineContent(hunk.header.content)}
              className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1 rounded hover:bg-[var(--hover-color)] transition-colors"
              title="Copy hunk header"
            >
              <Copy size={10} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDiffLine = (line: GitDiffLine, index: number, hunkId: number) => {
    const getLineClasses = () => {
      const base = "group hover:bg-[var(--hover-color)]/50 transition-colors border-l-2";
      switch (line.line_type) {
        case "added":
          return `${base} bg-green-500/5 border-green-500/30 hover:bg-green-500/10`;
        case "removed":
          return `${base} bg-red-500/5 border-red-500/30 hover:bg-red-500/10`;
        default:
          return `${base} border-transparent`;
      }
    };

    const getLineNumberBg = () => {
      switch (line.line_type) {
        case "added":
          return "bg-green-500/10";
        case "removed":
          return "bg-red-500/10";
        default:
          return "bg-[var(--secondary-bg)]";
      }
    };

    const oldNum = line.old_line_number?.toString() || "";
    const newNum = line.new_line_number?.toString() || "";

    if (viewMode === "split") {
      return (
        <div key={`${hunkId}-${index}`} className={`flex text-xs font-mono ${getLineClasses()}`}>
          {/* Old/Left Side */}
          <div className="flex-1 flex border-r border-[var(--border-color)]">
            {/* Old Line Number */}
            <div
              className={`w-12 px-2 py-1 text-right text-[var(--text-lighter)] select-none ${getLineNumberBg()} border-r border-[var(--border-color)]`}
            >
              {line.line_type !== "added" ? oldNum : ""}
            </div>

            {/* Old Content */}
            <div className="flex-1 py-1 px-3 overflow-x-auto">
              {line.line_type === "removed" ? (
                <span className="text-red-300 bg-red-500/10">{line.content || " "}</span>
              ) : line.line_type === "context" ? (
                <span className="text-[var(--text-color)]">{line.content || " "}</span>
              ) : (
                <span className="text-transparent select-none">&nbsp;</span>
              )}
            </div>
          </div>

          {/* New/Right Side */}
          <div className="flex-1 flex">
            {/* New Line Number */}
            <div
              className={`w-12 px-2 py-1 text-right text-[var(--text-lighter)] select-none ${getLineNumberBg()} border-r border-[var(--border-color)]`}
            >
              {line.line_type !== "removed" ? newNum : ""}
            </div>

            {/* New Content */}
            <div className="flex-1 py-1 px-3 overflow-x-auto">
              {line.line_type === "added" ? (
                <span className="text-green-300 bg-green-500/10">{line.content || " "}</span>
              ) : line.line_type === "context" ? (
                <span className="text-[var(--text-color)]">{line.content || " "}</span>
              ) : (
                <span className="text-transparent select-none">&nbsp;</span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => copyLineContent(line.content)}
                className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1 rounded hover:bg-[var(--hover-color)] transition-colors"
                title="Copy line"
              >
                <Copy size={10} />
              </button>
              {(onStageLine || onUnstageLine) && line.line_type !== "context" && (
                <>
                  {onStageLine && line.line_type === "added" && (
                    <button
                      onClick={() => onStageLine(line)}
                      className="text-green-400 hover:text-green-300 p-1 rounded hover:bg-green-500/20 transition-colors"
                      title="Stage line"
                    >
                      <Plus size={10} />
                    </button>
                  )}
                  {onUnstageLine && line.line_type === "removed" && (
                    <button
                      onClick={() => onUnstageLine(line)}
                      className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/20 transition-colors"
                      title="Unstage line"
                    >
                      <Minus size={10} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Unified view (original implementation)
    return (
      <div key={`${hunkId}-${index}`} className={`flex text-xs font-mono ${getLineClasses()}`}>
        {/* Line Numbers */}
        <div className={`flex ${getLineNumberBg()} border-r border-[var(--border-color)]`}>
          <div className="w-12 px-2 py-1 text-right text-[var(--text-lighter)] select-none">
            {oldNum}
          </div>
          <div className="w-12 px-2 py-1 text-right text-[var(--text-lighter)] select-none border-l border-[var(--border-color)]">
            {newNum}
          </div>
        </div>

        {/* Change Indicator */}
        <div className="w-8 flex items-center justify-center py-1 bg-[var(--secondary-bg)] border-r border-[var(--border-color)]">
          {line.line_type === "added" && (
            <span className="text-green-500 font-bold text-sm">+</span>
          )}
          {line.line_type === "removed" && (
            <span className="text-red-500 font-bold text-sm">−</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 py-1 px-3 overflow-x-auto">
          <span
            className={
              line.line_type === "added"
                ? "text-green-300"
                : line.line_type === "removed"
                  ? "text-red-300"
                  : "text-[var(--text-color)]"
            }
          >
            {line.content || " "}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => copyLineContent(line.content)}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1 rounded hover:bg-[var(--hover-color)] transition-colors"
            title="Copy line"
          >
            <Copy size={10} />
          </button>
          {(onStageLine || onUnstageLine) && line.line_type !== "context" && (
            <>
              {onStageLine && line.line_type === "added" && (
                <button
                  onClick={() => onStageLine(line)}
                  className="text-green-400 hover:text-green-300 p-1 rounded hover:bg-green-500/20 transition-colors"
                  title="Stage line"
                >
                  <Plus size={10} />
                </button>
              )}
              {onUnstageLine && line.line_type === "removed" && (
                <button
                  onClick={() => onUnstageLine(line)}
                  className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/20 transition-colors"
                  title="Unstage line"
                >
                  <Minus size={10} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const hunks = groupLinesIntoHunks(diff.lines);
  const contextLines = diff.lines.filter(line => line.line_type === "context").length;
  const addedLines = diff.lines.filter(line => line.line_type === "added").length;
  const removedLines = diff.lines.filter(line => line.line_type === "removed").length;

  return (
    <div className="flex flex-col h-full bg-[var(--primary-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--secondary-bg)]">
        <div className="flex items-center gap-2">
          {getFileIcon()}
          <div>
            <h3 className="text-sm font-medium text-[var(--text-color)]">
              {fileName || diff.file_path}
            </h3>
            <div className="flex items-center gap-3 text-xs text-[var(--text-lighter)]">
              <span className="capitalize">{getFileStatus()}</span>
              {removedLines > 0 && (
                <span className="text-red-400 bg-red-500/10 px-2 py-0.5 rounded">
                  -{removedLines}
                </span>
              )}
              {addedLines > 0 && (
                <span className="text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                  +{addedLines}
                </span>
              )}
              {hunks.length > 0 && (
                <span className="text-[var(--text-lighter)]">
                  {hunks.length} {hunks.length === 1 ? "hunk" : "hunks"}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === "unified" ? "split" : "unified")}
            className="text-xs px-2 py-1 bg-[var(--hover-color)] text-[var(--text-color)] hover:bg-[var(--border-color)] rounded transition-colors"
            title={`Switch to ${viewMode === "unified" ? "split" : "unified"} view`}
          >
            {viewMode === "unified" ? "Split" : "Unified"}
          </button>
          <button
            onClick={onClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] p-1 rounded hover:bg-[var(--hover-color)]"
            title="Close diff viewer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* File path info for renames */}
      {diff.is_renamed && diff.old_path && diff.new_path && (
        <div className="px-4 py-2 bg-blue-500/10 border-b border-[var(--border-color)]">
          <p className="text-xs text-blue-400">
            Renamed from <span className="font-mono">{diff.old_path}</span> to{" "}
            <span className="font-mono">{diff.new_path}</span>
          </p>
        </div>
      )}

      {/* Diff Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {hunks.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FileIcon size={48} className="mx-auto mb-4 opacity-50 text-[var(--text-lighter)]" />
              <p className="text-[var(--text-lighter)] text-sm">No changes to display</p>
            </div>
          </div>
        ) : (
          <div className="font-mono">
            {hunks.map(hunk => (
              <div key={hunk.id} className="border-b border-[var(--border-color)] last:border-b-0">
                {renderHunkHeader(hunk)}
                {!collapsedHunks.has(hunk.id) && (
                  <div className="bg-[var(--primary-bg)]">
                    {hunk.lines.map((line, index) => renderDiffLine(line, index, hunk.id))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      <div className="px-4 py-2 border-t border-[var(--border-color)] bg-[var(--secondary-bg)]">
        <div className="flex items-center gap-4 text-xs text-[var(--text-lighter)]">
          <span>Total lines: {diff.lines.length}</span>
          {addedLines > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              {addedLines} added
            </span>
          )}
          {removedLines > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
              {removedLines} removed
            </span>
          )}
          {contextLines > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
              {contextLines} unchanged
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiffViewer;
