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
    <div className="flex min-h-[28px] items-center justify-between border-border border-b bg-secondary-bg px-3 py-1">
      <div className="flex items-center gap-0.5 overflow-hidden font-mono text-text-lighter text-xs">
        {segments.map((segment, index) => (
          <div key={index} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && (
              <ChevronRight size={10} className="mx-0.5 flex-shrink-0 text-text-lighter" />
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
              className="max-w-[120px] truncate rounded px-1 py-0.5 text-xs transition-colors hover:text-text"
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
          className={`rounded p-1 transition-colors ${
            isOutlineVisible
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
          title="Toggle Outline"
        >
          <List size={12} />
        </button>

        <button
          onClick={onToggleMinimap}
          className={`rounded p-1 transition-colors ${
            isMinimapVisible
              ? "bg-selected text-text"
              : "text-text-lighter hover:bg-hover hover:text-text"
          }`}
          title="Toggle Minimap"
        >
          <MapIcon size={12} />
        </button>
      </div>
    </div>
  );
}
