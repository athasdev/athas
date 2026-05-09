import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DownloadSimple,
  PencilSimple as Edit,
  Folder,
  Plus,
  PushPin,
  PushPinSlash,
  HardDrives as Server,
  ArrowSquareOut as SquareArrowOutUpRight,
  Trash as Trash2,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { memo, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdeSettingsImportDialog } from "@/features/file-system/components/ide-settings-import-dialog";
import { useRecentFoldersStore } from "@/features/file-system/controllers/recent-folders-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders";
import ConnectionDialog from "@/features/remote/connection-dialog";
import PasswordPromptDialog from "@/features/remote/password-prompt-dialog";
import {
  connectRemoteConnection,
  loadRemoteConnections,
} from "@/features/remote/services/remote-connection-actions";
import type { RemoteConnection, RemoteConnectionFormData } from "@/features/remote/types";
import { getFriendlyRemoteError, isRemoteAuthFailure } from "@/features/remote/utils/remote-errors";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { connectionStore } from "@/features/remote/services/remote-connection-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";

interface ProjectPickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectPickerDialog = memo(({ isOpen, onClose }: ProjectPickerDialogProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<RemoteConnection | null>(null);
  const [passwordPromptConnection, setPasswordPromptConnection] = useState<RemoteConnection | null>(
    null,
  );
  const [connectingMap, setConnectingMap] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, "idle" | "error">>({});

  const recentFolders = useRecentFoldersStore((state) => state.recentFolders);
  const { addToRecents, openRecentFolder, removeFromRecents, togglePinned } =
    useRecentFoldersStore();
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
      setQuery("");
      setSelectedIndex(0);
      loadConnections();
      window.setTimeout(() => inputRef.current?.focus(), 0);
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

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleOpenFolderClick = async () => {
    onClose();
    await handleOpenFolder();
  };

  const handleImportSettingsClick = () => {
    setIsImportDialogOpen(true);
  };

  const handleAddRemoteConnectionClick = () => {
    setEditingConnection(null);
    setIsConnectionDialogOpen(true);
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
    addToRecents(folder.path, {
      customIcon: folder.customIcon,
      missing: false,
      openInNewWindow: true,
    });
  };

  const handleRemoteConnectionNewWindowClick = async (connection: RemoteConnection) => {
    onClose();
    await createAppWindow({
      remoteConnectionId: connection.id,
      remoteConnectionName: connection.name,
    });
  };

  const handleConnect = async (connectionId: string, providedPassword?: string) => {
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

      if (isRemoteAuthFailure(error) && !providedPassword && !connection.password) {
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

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRecentFolders = useMemo(() => {
    if (!normalizedQuery) return recentFolders;
    return recentFolders.filter((folder) =>
      [folder.name, folder.path].some((value) => value.toLowerCase().includes(normalizedQuery)),
    );
  }, [normalizedQuery, recentFolders]);

  const filteredConnections = useMemo(() => {
    if (!normalizedQuery) return connections;
    return connections.filter((connection) =>
      [connection.name, connection.host, connection.username, connection.type].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [connections, normalizedQuery]);

  const commandEntries = useMemo(
    () => [
      {
        id: "open-folder",
        onSelect: () => void handleOpenFolderClick(),
      },
      {
        id: "import-settings",
        onSelect: handleImportSettingsClick,
      },
      {
        id: "add-remote",
        onSelect: handleAddRemoteConnectionClick,
      },
      ...filteredRecentFolders.map((folder) => ({
        id: `recent:${folder.path}`,
        onSelect: () => void handleRecentFolderClick(folder),
      })),
      ...filteredConnections.map((connection) => ({
        id: `remote:${connection.id}`,
        onSelect: () => void handleConnect(connection.id),
      })),
    ],
    [filteredConnections, filteredRecentFolders],
  );

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(commandEntries.length - 1, 0)));
  }, [commandEntries.length]);

  const handleCommandKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (commandEntries.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % commandEntries.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + commandEntries.length) % commandEntries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commandEntries[selectedIndex]?.onSelect();
    }
  };

  const getEntryIndex = (id: string) => commandEntries.findIndex((entry) => entry.id === id);

  if (!isOpen) return null;

  return (
    <>
      <Command isVisible={isOpen} onClose={onClose} title="Open Project" className="w-[720px]">
        <CommandHeader onClose={onClose}>
          <Folder className="size-4 shrink-0 text-text-lighter" weight="duotone" />
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={handleCommandKeyDown}
            placeholder="Open project or remote connection"
          />
        </CommandHeader>
        <CommandList>
          <div className="p-1">
            <CommandItem
              isSelected={selectedIndex === getEntryIndex("open-folder")}
              onMouseEnter={() => setSelectedIndex(getEntryIndex("open-folder"))}
              onClick={() => void handleOpenFolderClick()}
              className="h-auto min-h-12 py-2"
            >
              <Folder className="size-4 shrink-0 text-text-lighter" weight="duotone" />
              <div className="min-w-0 flex-1 space-y-0.5 text-left">
                <div className="ui-text-sm text-text">Open Folder</div>
                <div className="ui-text-xs truncate text-text-lighter">Choose a local project</div>
              </div>
            </CommandItem>
            <CommandItem
              isSelected={selectedIndex === getEntryIndex("import-settings")}
              onMouseEnter={() => setSelectedIndex(getEntryIndex("import-settings"))}
              onClick={handleImportSettingsClick}
              className="h-auto min-h-12 py-2"
            >
              <DownloadSimple className="size-4 shrink-0 text-text-lighter" weight="duotone" />
              <div className="min-w-0 flex-1 space-y-0.5 text-left">
                <div className="ui-text-sm text-text">Import Editor Settings</div>
                <div className="ui-text-xs truncate text-text-lighter">
                  Bring recent projects from another editor
                </div>
              </div>
            </CommandItem>
            <CommandItem
              isSelected={selectedIndex === getEntryIndex("add-remote")}
              onMouseEnter={() => setSelectedIndex(getEntryIndex("add-remote"))}
              onClick={handleAddRemoteConnectionClick}
              className="h-auto min-h-12 py-2"
            >
              <Plus className="size-4 shrink-0 text-text-lighter" weight="duotone" />
              <div className="min-w-0 flex-1 space-y-0.5 text-left">
                <div className="ui-text-sm text-text">Add Remote Connection</div>
                <div className="ui-text-xs truncate text-text-lighter">
                  Create an SSH or remote workspace entry
                </div>
              </div>
            </CommandItem>
          </div>

          {filteredRecentFolders.length > 0 ? (
            <div className="border-border border-t p-1">
              <div className="ui-text-xs px-2.5 py-1.5 font-medium text-text-lighter">Recent</div>
              {filteredRecentFolders.map((folder) => {
                const matchingTab = projectTabs.find((t) => t.path === folder.path);
                const iconPath = folder.customIcon ?? matchingTab?.customIcon;
                const entryIndex = getEntryIndex(`recent:${folder.path}`);

                return (
                  <div
                    key={folder.path}
                    className={cn(
                      "group flex items-stretch rounded-lg",
                      folder.missing && "text-text-lighter",
                    )}
                  >
                    <CommandItem
                      isSelected={selectedIndex === entryIndex}
                      onMouseEnter={() => setSelectedIndex(entryIndex)}
                      onClick={() => handleRecentFolderClick(folder)}
                      className="mb-0 h-auto min-h-12 min-w-0 flex-1 rounded-r-none py-2"
                    >
                      {iconPath ? (
                        <img
                          src={convertFileSrc(iconPath)}
                          alt=""
                          className="shrink-0 rounded-sm object-contain"
                          style={{
                            width: "var(--app-ui-font-size)",
                            height: "var(--app-ui-font-size)",
                          }}
                        />
                      ) : folder.missing ? (
                        <WarningCircle className="size-4 shrink-0 text-warning" />
                      ) : (
                        <Folder className="size-4 shrink-0 text-text-lighter" />
                      )}
                      <div className="min-w-0 flex-1 space-y-0.5 text-left">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="ui-text-sm truncate text-text">{folder.name}</span>
                          {folder.pinned ? (
                            <PushPin className="size-3.5 shrink-0 fill-current text-accent" />
                          ) : null}
                          {folder.missing ? (
                            <span className="ui-text-xs shrink-0 rounded bg-warning/10 px-1 text-warning">
                              Missing
                            </span>
                          ) : null}
                        </div>
                        <span className="ui-text-xs block truncate text-text-lighter">
                          {folder.path}
                        </span>
                      </div>
                    </CommandItem>
                    <div className="flex shrink-0 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-events-none">
                      <Button
                        onClick={() => togglePinned(folder.path)}
                        variant="ghost"
                        compact
                        tooltip={folder.pinned ? "Unpin recent project" : "Pin recent project"}
                        tooltipSide="bottom"
                      >
                        {folder.pinned ? <PushPinSlash /> : <PushPin />}
                      </Button>
                      <Button
                        onClick={() => void handleRecentFolderNewWindowClick(folder)}
                        variant="ghost"
                        compact
                        tooltip="Open in new window"
                        tooltipSide="bottom"
                      >
                        <SquareArrowOutUpRight />
                      </Button>
                      <Button
                        onClick={() => removeFromRecents(folder.path)}
                        variant="ghost"
                        compact
                        tooltip="Remove from recents"
                        tooltipSide="bottom"
                      >
                        <X />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {filteredConnections.length > 0 ? (
            <div className="border-border border-t p-1">
              <div className="ui-text-xs px-2.5 py-1.5 font-medium text-text-lighter">Remote</div>
              {filteredConnections.map((connection) => {
                const entryIndex = getEntryIndex(`remote:${connection.id}`);

                return (
                  <div key={connection.id} className="group flex items-stretch rounded-lg">
                    <CommandItem
                      isSelected={selectedIndex === entryIndex}
                      onMouseEnter={() => setSelectedIndex(entryIndex)}
                      onClick={() => handleConnect(connection.id)}
                      className={cn(
                        "mb-0 h-auto min-h-12 min-w-0 flex-1 rounded-r-none py-2",
                        connectingMap[connection.id] && "cursor-not-allowed opacity-70",
                      )}
                      disabled={!!connectingMap[connection.id]}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-300">
                        <Server />
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5 text-left">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="ui-text-sm truncate text-text">{connection.name}</span>
                          <span className="ui-text-xs shrink-0 rounded bg-secondary-bg px-1 text-text-lighter">
                            {connection.type.toUpperCase()}
                          </span>
                        </div>
                        <span className="ui-text-xs block truncate text-text-lighter">
                          {connectingMap[connection.id]
                            ? "Connecting..."
                            : statusMap[connection.id] === "error"
                              ? "Connection failed"
                              : `${connection.username}@${connection.host}`}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          connection.isConnected ? "bg-green-500" : "bg-text-lighter/40",
                        )}
                      />
                      <span className="sr-only">
                        {connection.isConnected ? "Connected" : "Disconnected"}
                      </span>
                    </CommandItem>
                    <div className="flex shrink-0 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 pointer-events-none">
                      <Button
                        onClick={() => void handleRemoteConnectionNewWindowClick(connection)}
                        variant="ghost"
                        compact
                        tooltip="Open in new window"
                        tooltipSide="bottom"
                      >
                        <SquareArrowOutUpRight />
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingConnection(connection);
                          setIsConnectionDialogOpen(true);
                        }}
                        variant="ghost"
                        compact
                        tooltip="Edit connection"
                        tooltipSide="bottom"
                      >
                        <Edit />
                      </Button>
                      <Button
                        onClick={() => handleDeleteConnection(connection.id)}
                        variant="ghost"
                        compact
                        className="hover:text-error"
                        tooltip="Delete connection"
                        tooltipSide="bottom"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {filteredRecentFolders.length === 0 && filteredConnections.length === 0 ? (
            <CommandEmpty>
              {normalizedQuery ? `No projects match "${query}".` : "No recent projects"}
            </CommandEmpty>
          ) : null}
        </CommandList>
      </Command>

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

      {isImportDialogOpen && (
        <IdeSettingsImportDialog onClose={() => setIsImportDialogOpen(false)} />
      )}
    </>
  );
});

ProjectPickerDialog.displayName = "ProjectPickerDialog";

export default ProjectPickerDialog;
