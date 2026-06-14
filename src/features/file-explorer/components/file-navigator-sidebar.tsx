import {
  ListBulletsIcon as ListBullets,
  MagnifyingGlassIcon as Search,
  TreeStructureIcon as TreeStructure,
} from "@phosphor-icons/react";
import {
  memo,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { cn } from "@/utils/cn";
import { getBaseName, getDirName, normalizePath } from "@/utils/path-helpers";
import { FileExplorerIcon } from "./file-explorer-icon";

export type FileNavigatorViewMode = "flat" | "tree";

const DEFAULT_NAVIGATOR_WIDTH = 224;
const MIN_NAVIGATOR_WIDTH = 176;
const MAX_NAVIGATOR_WIDTH = 420;
const RESIZE_STEP = 16;

export interface FileNavigatorItem {
  key: string;
  path: string;
  label?: string;
  iconPath?: string;
  iconClassName?: string;
  metadata?: Array<{
    label: ReactNode;
    className?: string;
  }>;
}

interface FileNavigatorNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children: FileNavigatorNode[];
  item?: FileNavigatorItem;
}

interface FileNavigatorSidebarProps {
  items: FileNavigatorItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
  ariaLabel?: string;
  viewMode?: FileNavigatorViewMode;
  onViewModeChange?: (viewMode: FileNavigatorViewMode) => void;
}

function createDirectoryNode(name: string, path: string): FileNavigatorNode {
  return {
    id: `dir:${path}`,
    name,
    path,
    isDir: true,
    children: [],
  };
}

function clampNavigatorWidth(width: number) {
  return Math.max(MIN_NAVIGATOR_WIDTH, Math.min(width, MAX_NAVIGATOR_WIDTH));
}

function getItemSearchText(item: FileNavigatorItem) {
  return [item.label, item.path, item.key, item.iconPath].filter(Boolean).join(" ").toLowerCase();
}

function getFlatItemParts(item: FileNavigatorItem) {
  const path = normalizePath(item.label ?? item.path);
  const fileName = getBaseName(path, path);
  const directoryPath = getDirName(path);

  return {
    fileName,
    directoryPath,
    title: directoryPath ? `${fileName} - ${directoryPath}` : fileName,
  };
}

function buildFileTree(items: FileNavigatorItem[]): FileNavigatorNode[] {
  const root: FileNavigatorNode = createDirectoryNode("", "");

  for (const item of items) {
    const segments = item.path.split(/[\\/]/).filter(Boolean);
    if (segments.length === 0) continue;

    let current = root;
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = current.children.find((node) => node.isDir && node.name === segment);

      if (!child) {
        child = createDirectoryNode(segment, currentPath);
        current.children.push(child);
      }

      current = child;
    }

    const fileName = segments[segments.length - 1] ?? item.path;
    current.children.push({
      id: `file:${item.key}`,
      name: fileName,
      path: item.path,
      isDir: false,
      children: [],
      item,
    });
  }

  const sortNodes = (nodes: FileNavigatorNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) sortNodes(node.children);
  };

  sortNodes(root.children);
  return root.children;
}

const FileNavigatorMetadata = memo(function FileNavigatorMetadata({
  item,
}: {
  item: FileNavigatorItem;
}) {
  if (!item.metadata || item.metadata.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-1 tabular-nums">
      {item.metadata.map((metadata, index) => (
        <span key={index} className={metadata.className}>
          {metadata.label}
        </span>
      ))}
    </span>
  );
});

const FileNavigatorFlatRow = memo(function FileNavigatorFlatRow({
  item,
  selectedKey,
  onSelect,
}: {
  item: FileNavigatorItem;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const isSelected = selectedKey === item.key;
  const { fileName, directoryPath, title } = getFlatItemParts(item);

  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-2 text-left ui-text-xs text-text-lighter hover:bg-hover/40 hover:text-text",
        isSelected && "bg-selected text-text",
      )}
      onClick={() => onSelect(item.key)}
      aria-current={isSelected ? "true" : undefined}
      title={title}
    >
      <FileExplorerIcon
        fileName={item.iconPath ?? item.path}
        isDir={false}
        size={14}
        className={cn("shrink-0", item.iconClassName)}
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 max-w-[58%] shrink-0 truncate font-medium text-text">
          {fileName}
        </span>
        {directoryPath ? (
          <span className="min-w-0 flex-1 truncate text-text-lighter">{directoryPath}</span>
        ) : null}
      </span>
      <FileNavigatorMetadata item={item} />
    </button>
  );
});

const FileNavigatorNodeRow = memo(function FileNavigatorNodeRow({
  node,
  depth,
  selectedKey,
  onSelect,
}: {
  node: FileNavigatorNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  if (node.isDir) {
    return (
      <div>
        <div
          className="flex h-6 min-w-0 items-center gap-1.5 px-2 ui-text-xs text-text-lighter"
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <FileExplorerIcon
            fileName={node.name}
            isDir
            size={14}
            className="shrink-0 text-text-lighter"
          />
          <span className="truncate">{node.name}</span>
        </div>
        {node.children.map((child) => (
          <FileNavigatorNodeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const item = node.item;
  if (!item) return null;

  const isSelected = selectedKey === item.key;

  return (
    <button
      type="button"
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-2 text-left ui-text-xs text-text-lighter hover:bg-hover/40 hover:text-text",
        isSelected && "bg-selected text-text",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onSelect(item.key)}
      aria-current={isSelected ? "true" : undefined}
    >
      <FileExplorerIcon
        fileName={item.iconPath ?? node.name}
        isDir={false}
        size={14}
        className={cn("shrink-0", item.iconClassName)}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <FileNavigatorMetadata item={item} />
    </button>
  );
});

export const FileNavigatorSidebar = memo(function FileNavigatorSidebar({
  items,
  selectedKey,
  onSelect,
  className,
  ariaLabel = "Files",
  viewMode = "tree",
  onViewModeChange,
}: FileNavigatorSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_NAVIGATOR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return items;

    return items.filter((item) => getItemSearchText(item).includes(query));
  }, [items, searchQuery]);
  const tree = useMemo(() => buildFileTree(filteredItems), [filteredItems]);
  const flatItems = useMemo(
    () => [...filteredItems].sort((left, right) => left.path.localeCompare(right.path)),
    [filteredItems],
  );

  const resizeTo = useCallback((nextWidth: number) => {
    setWidth(clampNavigatorWidth(nextWidth));
  }, []);

  const handleResizeStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setIsResizing(true);

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        resizeTo(startWidth + moveEvent.clientX - startX);
      };

      const handlePointerUp = () => {
        setIsResizing(false);
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [resizeTo, width],
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      resizeTo(width + (event.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP));
    },
    [resizeTo, width],
  );

  return (
    <aside
      className={cn(
        "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border/70 bg-secondary-bg/20",
        className,
      )}
      style={{ width }}
      aria-label={ariaLabel}
    >
      {onViewModeChange ? (
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 text-text-lighter">
            <Search size={13} className="shrink-0" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 ui-text-xs text-text outline-none placeholder:text-text-lighter"
              placeholder="Search"
              aria-label="Search files"
            />
          </div>
          <div className="inline-flex shrink-0 rounded border border-border/70 bg-primary-bg p-0.5">
            <button
              type="button"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded text-text-lighter hover:bg-hover hover:text-text",
                viewMode === "flat" && "bg-selected text-text",
              )}
              onClick={() => onViewModeChange("flat")}
              aria-label="Show flat file list"
              aria-pressed={viewMode === "flat"}
              title="Flat list"
            >
              <ListBullets size={13} />
            </button>
            <button
              type="button"
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded text-text-lighter hover:bg-hover hover:text-text",
                viewMode === "tree" && "bg-selected text-text",
              )}
              onClick={() => onViewModeChange("tree")}
              aria-label="Show file tree"
              aria-pressed={viewMode === "tree"}
              title="File tree"
            >
              <TreeStructure size={13} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {filteredItems.length === 0 ? (
          <div className="px-2 py-2 ui-text-xs text-text-lighter">No files match</div>
        ) : viewMode === "flat" ? (
          flatItems.map((item) => (
            <FileNavigatorFlatRow
              key={item.key}
              item={item}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))
        ) : (
          tree.map((node) => (
            <FileNavigatorNodeRow
              key={node.id}
              node={node}
              depth={0}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
      <div
        className="absolute top-0 right-[-4px] z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-accent/20"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file navigator"
        aria-valuemin={MIN_NAVIGATOR_WIDTH}
        aria-valuemax={MAX_NAVIGATOR_WIDTH}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
      />
      {isResizing ? (
        <div className="pointer-events-none fixed inset-0 z-10 cursor-col-resize" />
      ) : null}
    </aside>
  );
});
