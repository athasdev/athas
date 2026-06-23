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
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import {
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarSearchFilterRow,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { getBaseName, getDirName, normalizePath } from "@/utils/path-helpers";
import { FileExplorerIcon } from "./file-explorer-icon";

export type FileNavigatorViewMode = "flat" | "tree";
export type FileNavigatorSearchMode = "substring" | "fuzzy";

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
  borderless?: boolean;
  searchMode?: FileNavigatorSearchMode;
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

function getFuzzyItemSearchScore(item: FileNavigatorItem, query: string) {
  const { fileName, directoryPath } = getFlatItemParts(item);
  const fields = [item.label, fileName, item.path, directoryPath, item.key, item.iconPath].filter(
    (value): value is string => Boolean(value),
  );

  return Math.max(...fields.map((field) => fuzzyScore(field, query)));
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
    <SidebarListItem
      onClick={() => onSelect(item.key)}
      aria-current={isSelected ? "true" : undefined}
      title={title}
      active={isSelected}
      className="h-7 min-h-0 gap-1.5 rounded px-2 py-0 ui-text-xs hover:bg-hover/40"
      leading={
        <FileExplorerIcon
          fileName={item.iconPath ?? item.path}
          isDir={false}
          size={14}
          className={cn("shrink-0", item.iconClassName)}
        />
      }
      trailing={<FileNavigatorMetadata item={item} />}
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 max-w-[58%] shrink-0 truncate font-medium text-text">
          {fileName}
        </span>
        {directoryPath ? (
          <span className="min-w-0 flex-1 truncate text-text-lighter">{directoryPath}</span>
        ) : null}
      </span>
    </SidebarListItem>
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
        <SidebarSectionLabel
          style={{ paddingLeft: 8 + depth * 12 }}
          leading={
            <FileExplorerIcon
              fileName={node.name}
              isDir
              size={14}
              className="shrink-0 text-text-lighter"
            />
          }
        >
          {node.name}
        </SidebarSectionLabel>
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
    <SidebarListItem
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onSelect(item.key)}
      aria-current={isSelected ? "true" : undefined}
      active={isSelected}
      title={item.path}
      className="h-7 min-h-0 gap-1.5 rounded px-2 py-0 ui-text-xs hover:bg-hover/40"
      contentClassName="truncate"
      leading={
        <FileExplorerIcon
          fileName={item.iconPath ?? node.name}
          isDir={false}
          size={14}
          className={cn("shrink-0", item.iconClassName)}
        />
      }
      trailing={<FileNavigatorMetadata item={item} />}
    >
      {node.name}
    </SidebarListItem>
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
  borderless = false,
  searchMode = "substring",
}: FileNavigatorSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [width, setWidth] = useState(DEFAULT_NAVIGATOR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const filteredItems = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return items;

    if (searchMode === "fuzzy") {
      return items
        .map((item) => ({
          item,
          score: getFuzzyItemSearchScore(item, trimmedQuery),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.item.path.localeCompare(right.item.path),
        )
        .map(({ item }) => item);
    }

    const query = trimmedQuery.toLowerCase();
    if (!query) return items;

    return items.filter((item) => getItemSearchText(item).includes(query));
  }, [items, searchMode, searchQuery]);
  const tree = useMemo(() => buildFileTree(filteredItems), [filteredItems]);
  const flatItems = useMemo(
    () =>
      searchMode === "fuzzy" && searchQuery.trim()
        ? filteredItems
        : [...filteredItems].sort((left, right) => left.path.localeCompare(right.path)),
    [filteredItems, searchMode, searchQuery],
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
        "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden",
        borderless ? "bg-transparent" : "border-r border-border/70 bg-secondary-bg/20",
        className,
      )}
      style={{ width }}
      aria-label={ariaLabel}
    >
      {onViewModeChange ? (
        <SidebarSearchFilterRow
          value={searchQuery}
          onChange={setSearchQuery}
          searchIcon={Search}
          placeholder="Search"
          searchAriaLabel="Search files"
          className={cn(borderless ? "px-1" : "border-b border-border/60")}
          actions={
            <div
              className={cn(
                "inline-flex shrink-0 rounded bg-primary-bg p-0.5",
                !borderless && "border border-border/70",
              )}
            >
              <SidebarHeaderIconButton
                className={cn("size-5 rounded", viewMode === "flat" && "bg-selected text-text")}
                onClick={() => onViewModeChange("flat")}
                aria-label="Show flat file list"
                aria-pressed={viewMode === "flat"}
                tooltip="Flat list"
                tooltipSide="bottom"
              >
                <ListBullets size={13} />
              </SidebarHeaderIconButton>
              <SidebarHeaderIconButton
                className={cn("size-5 rounded", viewMode === "tree" && "bg-selected text-text")}
                onClick={() => onViewModeChange("tree")}
                aria-label="Show file tree"
                aria-pressed={viewMode === "tree"}
                tooltip="File tree"
                tooltipSide="bottom"
              >
                <TreeStructure size={13} />
              </SidebarHeaderIconButton>
            </div>
          }
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {filteredItems.length === 0 ? (
          <SidebarSectionLabel>No files match</SidebarSectionLabel>
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
