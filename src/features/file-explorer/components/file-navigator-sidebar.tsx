import { ListBulletsIcon as ListBullets, TreeStructureIcon as TreeStructure } from "@/ui/icons";
import {
  memo,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cva } from "class-variance-authority";
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import { EmptyState } from "@/ui/empty";
import {
  SidebarHeader,
  SidebarSearchPopover,
  SidebarListItem,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { SidebarTree, SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import { buildPathTree, type PathTreeNode } from "@/features/sidebar/lib/path-tree";
import { ToggleGroup } from "@/ui/toggle-group";
import { cn } from "@/utils/cn";
import { ScrollArea } from "@/ui/scroll-area";
import { getBaseName, getDirName, normalizePath } from "@/utils/path-helpers";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import "../styles/file-explorer-tree.css";

export type FileNavigatorViewMode = "flat" | "tree";
type FileNavigatorSearchMode = "substring" | "fuzzy";
type FileNavigatorSurface = "sidebar" | "plain" | "inset" | "review";

const DEFAULT_NAVIGATOR_WIDTH = 224;
const MIN_NAVIGATOR_WIDTH = 176;
const MAX_NAVIGATOR_WIDTH = 420;
const RESIZE_STEP = 16;
const MAX_NAVIGATOR_SYNC_ITEMS = 5_000;

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
  "relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden",
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
          className={cn("shrink-0", item.iconClassName)}
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
    const expanded = !collapsedNodeIds.has(node.id);

    return (
      <div>
        <SidebarTreeRow
          depth={depth}
          expanded={expanded}
          onToggle={() => onToggle(node.id)}
          onClick={() => onToggle(node.id)}
          label={node.name}
          leading={
            <ThemedFileIcon
              fileName={node.name}
              isDir
              className="shrink-0 text-subtle-foreground"
            />
          }
          title={node.path}
          className={cn(compactRows && "py-1")}
        />
        {expanded
          ? node.children.map((child) => (
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
          className={cn("shrink-0", item.iconClassName)}
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
  const [width, setWidth] = useState(DEFAULT_NAVIGATOR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setSearchQuery("");
  }, [searchResetKey]);

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

  const resizeTo = useCallback((nextWidth: number) => {
    setWidth(clampNavigatorWidth(nextWidth));
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
      className={cn(fileNavigatorSurfaceVariants({ surface }), className)}
      style={{ width }}
      aria-label={ariaLabel}
    >
      {onViewModeChange ? (
        <SidebarHeader className={surface === "plain" ? "px-1" : undefined}>
          <SidebarSearchPopover
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label="Search files"
          />
          <ToggleGroup
            value={viewMode}
            onValueChange={onViewModeChange}
            ariaLabel="File navigator view"
            options={[
              { value: "flat", label: "Flat list", icon: <ListBullets /> },
              { value: "tree", label: "File tree", icon: <TreeStructure /> },
            ]}
            iconOnly
            variant="segmented"
            wrap={false}
            size="xs"
            className={cn("shrink-0", surface === "inset" && "bg-background")}
          />
        </SidebarHeader>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" contentClassName="p-1" orientation="both">
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
