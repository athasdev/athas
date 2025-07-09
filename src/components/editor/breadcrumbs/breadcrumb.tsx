import { ChevronRight, List, Map as MapIcon } from "lucide-react";

interface BreadcrumbProps {
  filePath: string;
  rootPath?: string | null;
  onNavigate: (path: string) => void;
  isOutlineVisible: boolean;
  isMinimapVisible: boolean;
  onToggleOutline: () => void;
  onToggleMinimap: () => void;
}

export default function Breadcrumb({
  filePath,
  rootPath,
  onNavigate,
  isOutlineVisible,
  isMinimapVisible,
  onToggleOutline,
  onToggleMinimap,
}: BreadcrumbProps) {
  const getPathSegments = () => {
    if (!filePath) return [];

    if (filePath.startsWith("remote://")) {
      const pathWithoutRemote = filePath.replace(/^remote:\/\/[^/]+/, "");
      return pathWithoutRemote.split("/").filter(Boolean);
    }

    if (filePath.includes("://")) {
      return [filePath.split("://")[1] || filePath];
    }

    if (rootPath && filePath.startsWith(rootPath)) {
      const relativePath = filePath.slice(rootPath.length);
      return relativePath.split("/").filter(Boolean);
    }

    return filePath.split("/").filter(Boolean);
  };

  const segments = getPathSegments();
  if (segments.length === 0) return null;

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-[var(--secondary-bg)] border-b border-[var(--border-color)] min-h-[28px]">
      <div className="flex items-center gap-0.5 text-xs text-[var(--text-lighter)] font-mono overflow-hidden">
        {segments.map((segment, index) => (
          <div key={index} className="flex items-center gap-0.5 min-w-0">
            {index > 0 && (
              <ChevronRight size={10} className="text-[var(--text-lighter)] flex-shrink-0 mx-0.5" />
            )}
            <button
              onClick={() => {
                if (rootPath) {
                  const fullPath = `${rootPath}/${segments.slice(0, index + 1).join("/")}`;
                  onNavigate(fullPath);
                } else {
                  onNavigate(segments.slice(0, index + 1).join("/"));
                }
              }}
              className="hover:text-[var(--text-color)] transition-colors truncate px-1 py-0.5 rounded text-xs max-w-[120px]"
              title={segment}
            >
              {segment}
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          onClick={onToggleOutline}
          className={`p-1 rounded transition-colors ${
            isOutlineVisible
              ? "bg-[var(--selected-color)] text-[var(--text-color)]"
              : "text-[var(--text-lighter)] hover:bg-[var(--hover-color)] hover:text-[var(--text-color)]"
          }`}
          title="Toggle Outline"
        >
          <List size={12} />
        </button>

        <button
          onClick={onToggleMinimap}
          className={`p-1 rounded transition-colors ${
            isMinimapVisible
              ? "bg-[var(--selected-color)] text-[var(--text-color)]"
              : "text-[var(--text-lighter)] hover:bg-[var(--hover-color)] hover:text-[var(--text-color)]"
          }`}
          title="Toggle Minimap"
        >
          <MapIcon size={12} />
        </button>
      </div>
    </div>
  );
}
