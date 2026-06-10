import { memo, useMemo } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { cn } from "@/utils/cn";

export interface DiffFileTreeItem {
  key: string;
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "modified" | "renamed";
  additions: number;
  deletions: number;
}

interface DiffFileTreeNode {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children: DiffFileTreeNode[];
  item?: DiffFileTreeItem;
}

interface GitDiffFileSidebarProps {
  items: DiffFileTreeItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  className?: string;
  ariaLabel?: string;
}

const statusClass: Record<DiffFileTreeItem["status"], string> = {
  added: "text-git-added",
  deleted: "text-git-deleted",
  modified: "text-git-modified",
  renamed: "text-git-renamed",
};

function createDirectoryNode(name: string, path: string): DiffFileTreeNode {
  return {
    id: `dir:${path}`,
    name,
    path,
    isDir: true,
    children: [],
  };
}

function buildFileTree(items: DiffFileTreeItem[]): DiffFileTreeNode[] {
  const root: DiffFileTreeNode = createDirectoryNode("", "");

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

  const sortNodes = (nodes: DiffFileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) sortNodes(node.children);
  };

  sortNodes(root.children);
  return root.children;
}

const DiffFileTreeNodeRow = memo(function DiffFileTreeNodeRow({
  node,
  depth,
  selectedKey,
  onSelect,
}: {
  node: DiffFileTreeNode;
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
          <DiffFileTreeNodeRow
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
        fileName={node.name}
        isDir={false}
        size={14}
        className={cn("shrink-0", statusClass[item.status])}
      />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <span className="flex shrink-0 items-center gap-1 tabular-nums">
        {item.additions > 0 ? <span className="text-git-added">+{item.additions}</span> : null}
        {item.deletions > 0 ? <span className="text-git-deleted">-{item.deletions}</span> : null}
      </span>
    </button>
  );
});

export const GitDiffFileSidebar = memo(function GitDiffFileSidebar({
  items,
  selectedKey,
  onSelect,
  className,
  ariaLabel = "Changed files",
}: GitDiffFileSidebarProps) {
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
        <DiffFileTreeNodeRow
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
