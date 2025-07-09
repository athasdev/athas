import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Loader,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";

interface RemoteFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: string;
}

interface RemoteFileTreeProps {
  connectionId: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
}

interface TreeNode extends RemoteFileEntry {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
  error?: string;
}

const RemoteFileTree = ({ connectionId, onFileSelect }: RemoteFileTreeProps) => {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDirectory("/");
  }, [connectionId]);

  const loadDirectory = async (path: string): Promise<TreeNode[]> => {
    try {
      const files = await invoke<RemoteFileEntry[]>("ssh_list_directory", {
        connectionId,
        path,
      });

      return files.map(file => ({
        ...file,
        children: file.is_dir ? [] : undefined,
        isExpanded: false,
        isLoading: false,
      }));
    } catch (error) {
      console.error("Failed to load directory:", error);
      throw error;
    }
  };

  const handleDirectoryClick = async (node: TreeNode, nodePath: number[]) => {
    if (!node.is_dir) {
      onFileSelect?.(node.path, false);
      return;
    }

    const updateNode = (
      nodes: TreeNode[],
      path: number[],
      updater: (node: TreeNode) => TreeNode,
    ): TreeNode[] => {
      if (path.length === 0) return nodes;
      if (path.length === 1) {
        return nodes.map((n, i) => (i === path[0] ? updater(n) : n));
      }
      return nodes.map((n, i) =>
        i === path[0]
          ? { ...n, children: updateNode(n.children || [], path.slice(1), updater) }
          : n,
      );
    };

    if (node.isExpanded) {
      // Collapse directory
      const updater = (n: TreeNode) => ({ ...n, isExpanded: false });
      setRootNodes(nodes => updateNode(nodes, nodePath, updater));
    } else {
      // Expand directory
      const updater = (n: TreeNode) => ({ ...n, isLoading: true, isExpanded: true });
      setRootNodes(nodes => updateNode(nodes, nodePath, updater));

      try {
        const children = await loadDirectory(node.path);
        const finalUpdater = (n: TreeNode) => ({
          ...n,
          children,
          isLoading: false,
          isExpanded: true,
          error: undefined,
        });
        setRootNodes(nodes => updateNode(nodes, nodePath, finalUpdater));
      } catch (error) {
        const errorUpdater = (n: TreeNode) => ({
          ...n,
          isLoading: false,
          error: `Failed to load: ${error}`,
          isExpanded: false,
        });
        setRootNodes(nodes => updateNode(nodes, nodePath, errorUpdater));
      }
    }
  };

  const renderNode = (
    node: TreeNode,
    depth: number = 0,
    nodePath: number[] = [],
  ): React.ReactNode => {
    const indent = depth * 12;

    return (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center py-1 px-2 hover:bg-[var(--hover-color)] cursor-pointer transition-colors group",
            "text-sm text-[var(--text-color)]",
          )}
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => handleDirectoryClick(node, nodePath)}
          title={node.path}
        >
          {node.is_dir && (
            <div className="w-4 h-4 flex items-center justify-center mr-1">
              {node.isLoading ? (
                <Loader size={12} className="animate-spin text-[var(--text-lighter)]" />
              ) : node.error ? (
                <AlertCircle size={12} className="text-red-500" />
              ) : node.isExpanded ? (
                <ChevronDown size={12} className="text-[var(--text-lighter)]" />
              ) : (
                <ChevronRight size={12} className="text-[var(--text-lighter)]" />
              )}
            </div>
          )}

          <div className="w-4 h-4 flex items-center justify-center mr-2">
            {node.is_dir ? (
              node.isExpanded ? (
                <FolderOpen size={14} className="text-blue-500" />
              ) : (
                <Folder size={14} className="text-blue-500" />
              )
            ) : (
              <File size={14} className="text-[var(--text-lighter)]" />
            )}
          </div>

          <span className="truncate flex-1 select-none">{node.name}</span>

          {!node.is_dir && node.size > 0 && (
            <span className="text-xs text-[var(--text-lighter)] ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {formatFileSize(node.size)}
            </span>
          )}
        </div>

        {node.error && (
          <div
            className="text-xs text-red-500 px-2 py-1"
            style={{ paddingLeft: `${20 + indent}px` }}
          >
            {node.error}
          </div>
        )}

        {node.isExpanded && node.children && (
          <div>
            {node.children.map((child, index) =>
              renderNode(child, depth + 1, [...nodePath, index]),
            )}
          </div>
        )}
      </div>
    );
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
  };

  useEffect(() => {
    const initializeRoot = async () => {
      try {
        setLoading(true);
        setError(null);
        const files = await loadDirectory("/");
        setRootNodes(files);
      } catch (error) {
        setError(`Failed to load root directory: ${error}`);
      } finally {
        setLoading(false);
      }
    };

    initializeRoot();
  }, [connectionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader size={24} className="animate-spin text-[var(--text-lighter)]" />
        <span className="ml-2 text-sm text-[var(--text-lighter)]">Loading remote files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-32 p-4">
        <AlertCircle size={24} className="text-red-500 mb-2" />
        <span className="text-sm text-red-500 text-center">{error}</span>
        <button
          onClick={() => loadDirectory("/")}
          className="mt-2 px-3 py-1 text-xs bg-[var(--hover-color)] text-[var(--text-color)] rounded hover:bg-[var(--border-color)] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {rootNodes.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-[var(--text-lighter)]">
          No files found
        </div>
      ) : (
        <div className="py-1">{rootNodes.map((node, index) => renderNode(node, 0, [index]))}</div>
      )}
    </div>
  );
};

export default RemoteFileTree;
