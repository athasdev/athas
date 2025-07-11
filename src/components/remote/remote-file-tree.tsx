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
            "group flex cursor-pointer items-center px-2 py-1 transition-colors hover:bg-hover",
            "text-sm text-text",
          )}
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => handleDirectoryClick(node, nodePath)}
          title={node.path}
        >
          {node.is_dir && (
            <div className="mr-1 flex h-4 w-4 items-center justify-center">
              {node.isLoading ? (
                <Loader size={12} className="animate-spin text-text-lighter" />
              ) : node.error ? (
                <AlertCircle size={12} className="text-red-500" />
              ) : node.isExpanded ? (
                <ChevronDown size={12} className="text-text-lighter" />
              ) : (
                <ChevronRight size={12} className="text-text-lighter" />
              )}
            </div>
          )}

          <div className="mr-2 flex h-4 w-4 items-center justify-center">
            {node.is_dir ? (
              node.isExpanded ? (
                <FolderOpen size={14} className="text-blue-500" />
              ) : (
                <Folder size={14} className="text-blue-500" />
              )
            ) : (
              <File size={14} className="text-text-lighter" />
            )}
          </div>

          <span className="flex-1 select-none truncate">{node.name}</span>

          {!node.is_dir && node.size > 0 && (
            <span className="ml-2 text-text-lighter text-xs opacity-0 transition-opacity group-hover:opacity-100">
              {formatFileSize(node.size)}
            </span>
          )}
        </div>

        {node.error && (
          <div
            className="px-2 py-1 text-red-500 text-xs"
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
      <div className="flex h-32 items-center justify-center">
        <Loader size={24} className="animate-spin text-text-lighter" />
        <span className="ml-2 text-sm text-text-lighter">Loading remote files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 flex-col items-center justify-center p-4">
        <AlertCircle size={24} className="mb-2 text-red-500" />
        <span className="text-center text-red-500 text-sm">{error}</span>
        <button
          onClick={() => loadDirectory("/")}
          className="mt-2 rounded bg-hover px-3 py-1 text-text text-xs transition-colors hover:bg-border"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {rootNodes.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-lighter">
          No files found
        </div>
      ) : (
        <div className="py-1">{rootNodes.map((node, index) => renderNode(node, 0, [index]))}</div>
      )}
    </div>
  );
};

export default RemoteFileTree;
