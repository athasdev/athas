import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Edit,
  Folder,
  FolderOpen,
  Plus,
  Server,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { memo, useCallback, useEffect, useState } from "react";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders";
import ConnectionDialog from "@/features/remote/connection-dialog";
import PasswordPromptDialog from "@/features/remote/password-prompt-dialog";
import {
  connectRemoteConnection,
  loadRemoteConnections,
} from "@/features/remote/services/remote-connection-actions";
import type {
  RemoteConnection,
  RemoteConnectionFormData,
} from "@/features/remote/types";
import {
  getFriendlyRemoteError,
  isRemoteAuthFailure,
} from "@/features/remote/utils/remote-errors";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { paneIconButtonClassName, paneTitleClassName } from "@/ui/pane";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { connectionStore } from "@/features/remote/services/remote-connection-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";

interface ProjectPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectPickerDialog = memo(
  ({ isOpen, onClose }: ProjectPickerDialogProps) => {
    const [connections, setConnections] = useState<RemoteConnection[]>([]);
    const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
    const [editingConnection, setEditingConnection] =
      useState<RemoteConnection | null>(null);
    const [passwordPromptConnection, setPasswordPromptConnection] =
      useState<RemoteConnection | null>(null);
    const [connectingMap, setConnectingMap] = useState<Record<string, boolean>>(
      {},
    );
    const [statusMap, setStatusMap] = useState<
      Record<string, "idle" | "error">
    >({});

    const recentFolders = useRecentFoldersStore((state) => state.recentFolders);
    const { openRecentFolder, removeFromRecents } = useRecentFoldersStore();
    const { handleOpenFolder } = useFileSystemStore();
    const projectTabs = useWorkspaceTabsStore.use.projectTabs();

    // Load connections
    const loadConnections = useCallback(async () => {
      try {
        setConnections(await loadRemoteConnections());
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
      const unsubscribe = listen<{ connectionId: string; connected: boolean }>(
        "ssh_connection_status",
        async (event) => {
          await connectionStore.updateConnectionStatus(
            event.payload.connectionId,
            event.payload.connected,
          );
          await loadConnections();
        },
      );

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

    const handleRecentFolderNewWindowClick = async (folder: RecentFolder) => {
      onClose();
      await createAppWindow({
        path: folder.path,
        isDirectory: true,
      });
    };

    const handleRemoteConnectionNewWindowClick = async (
      connection: RemoteConnection,
    ) => {
      onClose();
      await createAppWindow({
        remoteConnectionId: connection.id,
        remoteConnectionName: connection.name,
      });
    };

    const handleConnect = async (
      connectionId: string,
      providedPassword?: string,
    ) => {
      const connection = connections.find((c) => c.id === connectionId);
      if (!connection) return;

      try {
        if (connectingMap[connectionId]) return;
        setConnectingMap((p) => ({ ...p, [connectionId]: true }));
        setStatusMap((p) => ({ ...p, [connectionId]: "idle" }));
        await connectRemoteConnection(connection, providedPassword);
        await loadConnections();
        onClose();
      } catch (error) {
        console.error("Connection error:", error);

        if (
          isRemoteAuthFailure(error) &&
          !providedPassword &&
          !connection.password
        ) {
          setConnectingMap((p) => ({ ...p, [connectionId]: false }));
          setPasswordPromptConnection(connection);
          return;
        }

        if (providedPassword) {
          setConnectingMap((p) => ({ ...p, [connectionId]: false }));
          throw new Error(getFriendlyRemoteError(error));
        }

        setStatusMap((p) => ({ ...p, [connectionId]: "error" }));
        toast.error(getFriendlyRemoteError(error));
      } finally {
        setConnectingMap((p) => ({ ...p, [connectionId]: false }));
      }
    };

    const handleSaveConnection = async (
      formData: RemoteConnectionFormData,
    ): Promise<boolean> => {
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
        <Dialog
          title="Open Project"
          icon={FolderOpen}
          onClose={onClose}
          size="lg"
          classNames={{
            modal: "max-w-[560px] rounded-xl",
            content: "p-0",
          }}
        >
          <div className="max-h-[400px] overflow-y-auto">
            {/* Recent Projects */}
            <div className="border-border border-b">
              <div className="flex items-center justify-between bg-secondary-bg/40 px-3 py-2">
                <span className={paneTitleClassName("text-text-lighter")}>
                  Recent
                </span>
                <Button
                  onClick={handleOpenFolderClick}
                  variant="ghost"
                  size="icon-sm"
                  className={paneIconButtonClassName()}
                  aria-label="Open folder"
                >
                  <Plus />
                </Button>
              </div>
              {recentFolders.length > 0 ? (
                recentFolders.map((folder) => (
                  <div
                    key={folder.path}
                    className="group flex items-center hover:bg-hover"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRecentFolderClick(folder)}
                      className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-none px-3 py-1.5 hover:bg-transparent"
                    >
                      {(() => {
                        const matchingTab = projectTabs.find(
                          (t) => t.path === folder.path,
                        );
                        if (matchingTab?.customIcon) {
                          return (
                            <img
                              src={convertFileSrc(matchingTab.customIcon)}
                              alt=""
                              className="shrink-0 rounded-sm object-contain"
                              style={{
                                width: "var(--app-ui-font-size)",
                                height: "var(--app-ui-font-size)",
                              }}
                            />
                          );
                        }
                        return (
                          <Folder className="shrink-0 text-text-lighter" />
                        );
                      })()}
                      <span className="ui-text-sm truncate text-text">
                        {folder.name}
                      </span>
                      <span className="ui-text-sm ml-auto truncate text-text-lighter">
                        {folder.path}
                      </span>
                    </Button>
                    <Button
                      onClick={() =>
                        void handleRecentFolderNewWindowClick(folder)
                      }
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label="Open in new window"
                      title="Open in new window"
                    >
                      <SquareArrowOutUpRight />
                    </Button>
                    <Button
                      onClick={() => removeFromRecents(folder.path)}
                      variant="ghost"
                      size="icon-xs"
                      className="mr-2 shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label="Remove from recents"
                    >
                      <X />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="ui-text-sm px-3 py-3 text-center text-text-lighter">
                  No recent projects
                </div>
              )}
            </div>

            {/* Remote Connections */}
            <div>
              <div className="flex items-center justify-between bg-secondary-bg/40 px-3 py-2">
                <span className={paneTitleClassName("text-text-lighter")}>
                  Remote
                </span>
                <Button
                  onClick={() => {
                    setEditingConnection(null);
                    setIsConnectionDialogOpen(true);
                  }}
                  variant="ghost"
                  size="icon-sm"
                  className={paneIconButtonClassName()}
                  aria-label="Add remote connection"
                >
                  <Plus />
                </Button>
              </div>
              {connections.length > 0 ? (
                connections.map((connection) => (
                  <div
                    key={connection.id}
                    className="group flex items-center hover:bg-hover"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleConnect(connection.id)}
                      className={cn(
                        "h-auto min-w-0 flex-1 justify-start gap-2 rounded-none px-3 py-1.5 hover:bg-transparent",
                        "border-l-2 border-transparent hover:border-sky-500/35",
                        connectingMap[connection.id] &&
                          "cursor-not-allowed opacity-70",
                      )}
                      disabled={!!connectingMap[connection.id]}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-300">
                        <Server />
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="ui-text-sm truncate text-text">
                          {connection.name}
                        </span>
                        <span className="ui-text-sm truncate text-text-lighter">
                          {connectingMap[connection.id]
                            ? "Connecting…"
                            : statusMap[connection.id] === "error"
                              ? "Connection failed"
                              : `${connection.username}@${connection.host}`}
                        </span>
                      </div>
                      <span className="ui-text-sm text-text-lighter">
                        {connection.type.toUpperCase()}
                      </span>
                      <span
                        className={cn(
                          "ml-auto size-2 shrink-0 rounded-full",
                          connection.isConnected
                            ? "bg-green-500"
                            : "bg-text-lighter/40",
                        )}
                      />
                      <span className="sr-only">
                        {connection.isConnected ? "Connected" : "Disconnected"}
                      </span>
                    </Button>
                    <div className="mr-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        onClick={() =>
                          void handleRemoteConnectionNewWindowClick(connection)
                        }
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Open in new window"
                        title="Open in new window"
                      >
                        <SquareArrowOutUpRight />
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingConnection(connection);
                          setIsConnectionDialogOpen(true);
                        }}
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Edit connection"
                      >
                        <Edit />
                      </Button>
                      <Button
                        onClick={() => handleDeleteConnection(connection.id)}
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-error"
                        aria-label="Delete connection"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="ui-text-sm px-3 py-3 text-center text-text-lighter">
                  No remote connections
                </div>
              )}
            </div>
          </div>
        </Dialog>

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
  },
);

ProjectPickerDialog.displayName = "ProjectPickerDialog";

export default ProjectPickerDialog;
