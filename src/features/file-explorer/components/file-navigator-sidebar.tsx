import { memo, type ReactNode, useMemo } from "react";
import { cn } from "@/utils/cn";
import { FileExplorerIcon } from "./file-explorer-icon";

export interface FileNavigatorItem {
  key: string;
  path: string;
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

function buildFileTree(items: FileNavigatorItem[]): FileNavigatorNode[] {
  const root: FileNavigatorNode = createDirectoryNode("", "");

  for (const item of items) {
    const segments = item.path.split("/").filter(Boolean);
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
      {item.metadata && item.metadata.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          {item.metadata.map((metadata, index) => (
            <span key={index} className={metadata.className}>
              {metadata.label}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
});

export const FileNavigatorSidebar = memo(function FileNavigatorSidebar({
  items,
  selectedKey,
  onSelect,
  className,
  ariaLabel = "Files",
}: FileNavigatorSidebarProps) {
  const tree = useMemo(() => buildFileTree(items), [items]);

  return (
    <aside
      className={cn(
        "m-2 mr-0 min-h-0 w-56 shrink-0 overflow-auto rounded-md border border-border/70 bg-secondary-bg/20 p-1",
        className,
      )}
      aria-label={ariaLabel}
    >
      {tree.map((node) => (
        <FileNavigatorNodeRow
          key={node.id}
          node={node}
          depth={0}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </aside>
  );
});
