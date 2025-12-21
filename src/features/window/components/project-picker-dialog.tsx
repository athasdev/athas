import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Edit, Folder, FolderOpen, Plus, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders";
import ConnectionDialog from "@/features/remote/connection-dialog";
import PasswordPromptDialog from "@/features/remote/password-prompt-dialog";
import type { RemoteConnection, RemoteConnectionFormData } from "@/features/remote/types";
import { cn } from "@/utils/cn";
import { connectionStore } from "@/utils/connection-store";

interface ProjectPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectPickerDialog = memo(({ isOpen, onClose }: ProjectPickerDialogProps) => {
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RemoteConnection | null>(null);
  const [passwordPromptConnection, setPasswordPromptConnection] = useState<RemoteConnection | null>(
    null,
  );

  const recentFolders = useRecentFoldersStore((state) => state.recentFolders);
  const { openRecentFolder, removeFromRecents } = useRecentFoldersStore();
  const { handleOpenFolder, handleOpenRemoteProject } = useFileSystemStore();

  // Load connections
  const loadConnections = useCallback(async () => {
    try {
      const allConnections = await connectionStore.getAllConnections();
      setConnections(allConnections as RemoteConnection[]);
    } catch (error) {
      console.error("Failed to load connections:", error);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen, loadConnections]);

  // Listen for connection status changes
  useEffect(() => {
    const unsubscribe = listen("ssh_connection_status", () => {
      loadConnections();
    });

    return () => {
      unsubscribe.then((fn) => fn());
    };
  }, [loadConnections]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleOpenFolderClick = async () => {
    onClose();
    await handleOpenFolder();
  };

  const handleRecentFolderClick = async (folder: RecentFolder) => {
    onClose();
    await openRecentFolder(folder.path);
  };

  const handleConnect = async (connectionId: string, providedPassword?: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return;

    try {
      await invoke("ssh_connect", {
        connectionId,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: providedPassword || connection.password || null,
        keyPath: connection.keyPath || null,
        useSftp: connection.type === "sftp",
      });

      await connectionStore.updateConnectionStatus(connectionId, true, new Date().toISOString());
      await loadConnections();

      // Open the remote project
      if (handleOpenRemoteProject) {
        await handleOpenRemoteProject(connectionId, connection.name);
      }

      onClose();
    } catch (error) {
      console.error("Connection error:", error);
      const errorStr = String(error);

      const isAuthFailure =
        errorStr.includes("No valid authentication method") ||
        errorStr.includes("Authentication failed");

      if (isAuthFailure && !providedPassword && !connection.password) {
        setPasswordPromptConnection(connection);
        return;
      }

      if (providedPassword) {
        throw error;
      }
    }
  };

  const handleSaveConnection = async (formData: RemoteConnectionFormData): Promise<boolean> => {
    try {
      const connectionId = editingConnection?.id || `conn-${Date.now()}`;
      await connectionStore.saveConnection({
        id: connectionId,
        ...formData,
      });
      await loadConnections();
      setIsConnectionDialogOpen(false);
      setEditingConnection(null);
      return true;
    } catch (error) {
      console.error("Failed to save connection:", error);
      return false;
    }
  };

  const handleDeleteConnection = async (connectionId: string) => {
    try {
      await connectionStore.deleteConnection(connectionId);
      await loadConnections();
    } catch (error) {
      console.error("Failed to delete connection:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9998] bg-black/20 backdrop-blur-[1px]" onClick={onClose} />

      {/* Dialog */}
      <div className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-[9999] w-[560px] overflow-hidden rounded-lg border border-border bg-primary-bg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b bg-secondary-bg px-3 py-2">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-text-lighter" />
            <span className="font-medium text-text text-xs">Open Project</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[400px] overflow-y-auto">
          {/* Recent Projects */}
          <div className="border-border border-b">
            <div className="flex items-center justify-between bg-secondary-bg px-3 py-1.5">
              <span className="text-[10px] text-text-lighter uppercase">Recent</span>
              <button
                onClick={handleOpenFolderClick}
                className="rounded p-0.5 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label="Open folder"
              >
                <Plus size={12} />
              </button>
            </div>
            {recentFolders.length > 0 ? (
              recentFolders.map((folder) => (
                <div key={folder.path} className="group flex items-center hover:bg-hover">
                  <button
                    onClick={() => handleRecentFolderClick(folder)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  >
                    <Folder size={14} className="shrink-0 text-text-lighter" />
                    <span className="truncate text-text text-xs">{folder.name}</span>
                    <span className="ml-auto truncate text-[10px] text-text-lighter">
                      {folder.path}
                    </span>
                  </button>
                  <button
                    onClick={() => removeFromRecents(folder.path)}
                    className="mr-2 shrink-0 rounded p-1 text-text-lighter opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                    aria-label="Remove from recents"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-center text-text-lighter text-xs">
                No recent projects
              </div>
            )}
          </div>

          {/* Remote Connections */}
          <div>
            <div className="flex items-center justify-between bg-secondary-bg px-3 py-1.5">
              <span className="text-[10px] text-text-lighter uppercase">Remote</span>
              <button
                onClick={() => {
                  setEditingConnection(null);
                  setIsConnectionDialogOpen(true);
                }}
                className="rounded p-0.5 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label="Add remote connection"
              >
                <Plus size={12} />
              </button>
            </div>
            {connections.length > 0 ? (
              connections.map((connection) => (
                <div key={connection.id} className="group flex items-center hover:bg-hover">
                  <button
                    onClick={() => handleConnect(connection.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        connection.isConnected ? "bg-green-500" : "bg-text-lighter/40",
                      )}
                    />
                    <span className="truncate text-text text-xs">{connection.name}</span>
                    <span className="text-[10px] text-text-lighter">
                      {connection.type.toUpperCase()}
                    </span>
                    <span className="ml-auto truncate text-[10px] text-text-lighter">
                      {connection.username}@{connection.host}
                    </span>
                  </button>
                  <div className="mr-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditingConnection(connection);
                        setIsConnectionDialogOpen(true);
                      }}
                      className="rounded p-1 text-text-lighter hover:text-text"
                      aria-label="Edit connection"
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteConnection(connection.id)}
                      className="rounded p-1 text-text-lighter hover:text-error"
                      aria-label="Delete connection"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-3 text-center text-text-lighter text-xs">
                No remote connections
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Connection Dialog */}
      <ConnectionDialog
        isOpen={isConnectionDialogOpen}
        onClose={() => {
          setIsConnectionDialogOpen(false);
          setEditingConnection(null);
        }}
        onSave={handleSaveConnection}
        editingConnection={editingConnection}
      />

      {/* Password Prompt Dialog */}
      <PasswordPromptDialog
        isOpen={!!passwordPromptConnection}
        connection={passwordPromptConnection}
        onClose={() => setPasswordPromptConnection(null)}
        onConnect={handleConnect}
      />
    </>
  );
});

ProjectPickerDialog.displayName = "ProjectPickerDialog";

export default ProjectPickerDialog;
