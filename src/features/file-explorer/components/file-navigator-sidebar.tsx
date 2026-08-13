import { ListBulletsIcon as ListBullets, TreeStructureIcon as TreeStructure } from "@/ui/icons";
import {
  memo,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cva } from "class-variance-authority";
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import { EmptyState } from "@/ui/empty";
import {
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarSearchPopover,
  SidebarListItem,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { SidebarTree, SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import {
  buildPathTree,
  compactPathTreeBranch,
  type PathTreeNode,
} from "@/features/sidebar/lib/path-tree";
import { cn } from "@/utils/cn";
import { ScrollArea } from "@/ui/scroll-area";
import { getBaseName, getDirName, normalizePath } from "@/utils/path-helpers";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import {
  clampFileNavigatorWidth,
  DEFAULT_FILE_NAVIGATOR_WIDTH,
  getFileNavigatorLayout,
} from "@/features/file-explorer/lib/file-navigator-layout";
import "../styles/file-explorer-tree.css";

export type FileNavigatorViewMode = "flat" | "tree";
type FileNavigatorSearchMode = "substring" | "fuzzy";
type FileNavigatorSurface = "sidebar" | "plain" | "inset" | "review";
export type FileNavigatorTone =
  | "neutral"
  | "subtle"
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "error"
  | "info"
  | "warning";

const RESIZE_STEP = 16;
const MAX_NAVIGATOR_SYNC_ITEMS = 5_000;

export interface FileNavigatorItem {
  key: string;
  path: string;
  label?: string;
  iconPath?: string;
  iconTone?: FileNavigatorTone;
  metadata?: Array<{
    label: string | number;
    tone?: FileNavigatorTone;
  }>;
}

const fileNavigatorToneClass: Record<FileNavigatorTone, string> = {
  neutral: "text-foreground",
  subtle: "text-subtle-foreground",
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
  error: "text-destructive",
  info: "text-info",
  warning: "text-warning",
};

interface FileNavigatorSidebarProps {
  items: FileNavigatorItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
  ariaLabel?: string;
  viewMode?: FileNavigatorViewMode;
  onViewModeChange?: (viewMode: FileNavigatorViewMode) => void;
  surface?: FileNavigatorSurface;
  searchMode?: FileNavigatorSearchMode;
  compactRows?: boolean;
  searchResetKey?: string;
}

const fileNavigatorSurfaceVariants = cva(
  "relative flex h-full min-h-0 min-w-0 shrink flex-col overflow-hidden",
  {
    variants: {
      surface: {
        sidebar: "border-border/70 border-r bg-surface/20",
        plain: "bg-transparent",
        inset: "rounded-xl border border-border/70 bg-surface/20",
        review: "border-border/60 border-r bg-surface/10",
      },
    },
    defaultVariants: {
      surface: "sidebar",
    },
  },
);

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

const FileNavigatorMetadata = memo(function FileNavigatorMetadata({
  item,
}: {
  item: FileNavigatorItem;
}) {
  if (!item.metadata || item.metadata.length === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-1 tabular-nums">
      {item.metadata.map((metadata, index) => (
        <span key={index} className={fileNavigatorToneClass[metadata.tone ?? "neutral"]}>
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
  compactRows,
}: {
  item: FileNavigatorItem;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  compactRows?: boolean;
}) {
  const isSelected = selectedKey === item.key;
  const { fileName, directoryPath, title } = getFlatItemParts(item);

  return (
    <SidebarListItem
      onClick={() => onSelect(item.key)}
      aria-current={isSelected ? "true" : undefined}
      title={title}
      active={isSelected}
      leading={
        <ThemedFileIcon
          fileName={item.iconPath ?? item.path}
          isDir={false}
          className={cn("shrink-0", fileNavigatorToneClass[item.iconTone ?? "neutral"])}
        />
      }
      trailing={<FileNavigatorMetadata item={item} />}
      description={compactRows ? undefined : directoryPath}
      className={cn(compactRows && "py-1 ui-text-sm")}
    >
      {fileName}
    </SidebarListItem>
  );
});

const FileNavigatorNodeRow = memo(function FileNavigatorNodeRow({
  node,
  depth,
  selectedKey,
  onSelect,
  collapsedNodeIds,
  onToggle,
  compactRows,
}: {
  node: PathTreeNode<FileNavigatorItem>;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  collapsedNodeIds: ReadonlySet<string>;
  onToggle: (nodeId: string) => void;
  compactRows?: boolean;
}) {
  if (node.type === "branch") {
    const compacted = compactPathTreeBranch(node);
    const branch = compacted.branch;
    const expanded = !collapsedNodeIds.has(branch.id);

    return (
      <div>
        <SidebarTreeRow
          depth={depth}
          expanded={expanded}
          onToggle={() => onToggle(branch.id)}
          onClick={() => onToggle(branch.id)}
          label={compacted.label}
          leading={
            <ThemedFileIcon
              fileName={branch.name}
              isDir
              isExpanded={expanded}
              className="shrink-0 text-subtle-foreground"
            />
          }
          title={branch.path}
          className={cn(compactRows && "py-1")}
        />
        {expanded
          ? branch.children.map((child) => (
              <FileNavigatorNodeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedKey={selectedKey}
                onSelect={onSelect}
                collapsedNodeIds={collapsedNodeIds}
                onToggle={onToggle}
                compactRows={compactRows}
              />
            ))
          : null}
      </div>
    );
  }

  const item = node.item;
  const isSelected = selectedKey === item.key;

  return (
    <SidebarTreeRow
      depth={depth}
      onClick={() => onSelect(item.key)}
      active={isSelected}
      title={item.path}
      reserveDisclosureSpace
      label={node.name}
      leading={
        <ThemedFileIcon
          fileName={item.iconPath ?? node.name}
          isDir={false}
          className={cn("shrink-0", fileNavigatorToneClass[item.iconTone ?? "neutral"])}
        />
      }
      trailing={<FileNavigatorMetadata item={item} />}
      className={cn(compactRows && "py-1")}
    />
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
  surface = "sidebar",
  searchMode = "substring",
  compactRows = false,
  searchResetKey,
}: FileNavigatorSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const navigatorRef = useRef<HTMLElement>(null);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_FILE_NAVIGATOR_WIDTH);
  const [parentWidth, setParentWidth] = useState<number>();
  const [isResizing, setIsResizing] = useState(false);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSearchQuery("");
  }, [searchResetKey]);

  useEffect(() => {
    const parent = navigatorRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;

    const updateParentWidth = () => setParentWidth(parent.clientWidth);
    const resizeObserver = new ResizeObserver(updateParentWidth);
    resizeObserver.observe(parent);
    updateParentWidth();

    return () => resizeObserver.disconnect();
  }, []);

  const searchableItems = useMemo(() => items.slice(0, MAX_NAVIGATOR_SYNC_ITEMS), [items]);
  const hiddenItemCount = Math.max(0, items.length - searchableItems.length);
  const filteredItems = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return searchableItems;

    if (searchMode === "fuzzy") {
      const scoredItems: Array<{ item: FileNavigatorItem; score: number }> = [];
      for (const item of searchableItems) {
        const score = getFuzzyItemSearchScore(item, trimmedQuery);
        if (score > 0) {
          scoredItems.push({ item, score });
        }
      }

      scoredItems.sort(
        (left, right) => right.score - left.score || left.item.path.localeCompare(right.item.path),
      );
      return scoredItems.map(({ item }) => item);
    }

    const query = trimmedQuery.toLowerCase();
    if (!query) return searchableItems;

    return searchableItems.filter((item) => getItemSearchText(item).includes(query));
  }, [searchableItems, searchMode, searchQuery]);
  const tree = useMemo(
    () =>
      viewMode === "tree"
        ? buildPathTree(filteredItems, {
            getPath: (item) => item.path,
            getKey: (item) => item.key,
          })
        : [],
    [filteredItems, viewMode],
  );
  const flatItems = useMemo(() => {
    if (viewMode !== "flat") return [];
    return searchMode === "fuzzy" && searchQuery.trim()
      ? filteredItems
      : [...filteredItems].sort((left, right) => left.path.localeCompare(right.path));
  }, [filteredItems, searchMode, searchQuery, viewMode]);

  const navigatorLayout = getFileNavigatorLayout(preferredWidth, parentWidth);

  const resizeTo = useCallback((nextWidth: number) => {
    setPreferredWidth(clampFileNavigatorWidth(nextWidth));
  }, []);

  const handleToggleNode = useCallback((nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleResizeStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = navigatorLayout.width;
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
    [navigatorLayout.width, resizeTo],
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      resizeTo(navigatorLayout.width + (event.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP));
    },
    [navigatorLayout.width, resizeTo],
  );

  return (
    <aside
      ref={navigatorRef}
      className={cn(fileNavigatorSurfaceVariants({ surface }), className)}
      style={{ width: navigatorLayout.width }}
      aria-label={ariaLabel}
    >
      {onViewModeChange ? (
        <SidebarHeader className={surface === "plain" ? "px-1" : undefined}>
          <SidebarSearchPopover
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label="Search files"
          />
          <div
            className="ml-auto flex shrink-0 items-center gap-(--athas-chrome-gap)"
            role="group"
            aria-label="File navigator view"
          >
            <SidebarHeaderIconButton
              active={viewMode === "flat"}
              onClick={() => onViewModeChange("flat")}
              tooltip="Flat list"
              tooltipSide="bottom"
              aria-label="Flat list"
            >
              <ListBullets />
            </SidebarHeaderIconButton>
            <SidebarHeaderIconButton
              active={viewMode === "tree"}
              onClick={() => onViewModeChange("tree")}
              tooltip="File tree"
              tooltipSide="bottom"
              aria-label="File tree"
            >
              <TreeStructure />
            </SidebarHeaderIconButton>
          </div>
        </SidebarHeader>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" contentClassName="p-1" reserveScrollbarGutter>
        {hiddenItemCount > 0 ? (
          <SidebarSectionLabel>
            Showing {searchableItems.length.toLocaleString()} of {items.length.toLocaleString()}
          </SidebarSectionLabel>
        ) : null}
        {filteredItems.length === 0 ? (
          <EmptyState message="No files match" />
        ) : viewMode === "flat" ? (
          flatItems.map((item) => (
            <FileNavigatorFlatRow
              key={item.key}
              item={item}
              selectedKey={selectedKey}
              onSelect={onSelect}
              compactRows={compactRows}
            />
          ))
        ) : (
          <SidebarTree label={ariaLabel}>
            {tree.map((node) => (
              <FileNavigatorNodeRow
                key={node.id}
                node={node}
                depth={0}
                selectedKey={selectedKey}
                onSelect={onSelect}
                collapsedNodeIds={collapsedNodeIds}
                onToggle={handleToggleNode}
                compactRows={compactRows}
              />
            ))}
          </SidebarTree>
        )}
      </ScrollArea>
      <div
        className="absolute top-0 -right-1 z-20 h-full w-2 cursor-col-resize transition-colors hover:bg-primary/20"
        onPointerDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file navigator"
        aria-valuemin={navigatorLayout.minWidth}
        aria-valuemax={navigatorLayout.maxWidth}
        aria-valuenow={navigatorLayout.width}
        tabIndex={0}
      />
      {isResizing ? (
        <div className="pointer-events-none fixed inset-0 z-10 cursor-col-resize" />
      ) : null}
    </aside>
  );
});
