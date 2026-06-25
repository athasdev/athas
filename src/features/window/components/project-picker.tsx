import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  FolderIcon as Folder,
  PushPinIcon as PushPin,
  HardDrivesIcon as Server,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { memo, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IdeSettingsImportDialog } from "@/features/file-system/components/ide-settings-import-dialog";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { RecentFolder } from "@/features/file-system/types/recent-folders.types";
import { showPromptDialog } from "@/features/dialogs/services/dialog-service";
import ConnectionDialog from "@/features/remote/components/connection-dialog";
import PasswordPromptDialog from "@/features/remote/components/password-prompt-dialog";
import {
  connectRemoteConnection,
  loadRemoteConnections,
} from "@/features/remote/services/remote-connection-actions";
import type {
  RemoteConnection,
  RemoteConnectionFormData,
} from "@/features/remote/types/remote.types";
import type { WslDistribution } from "@/features/wsl/controllers/wsl-workspace";
import { getFriendlyRemoteError, isRemoteAuthFailure } from "@/features/remote/utils/remote-errors";
import Command, {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandItemMeta,
  CommandItemTitle,
  CommandList,
} from "@/ui/command";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";

interface ProjectPickerProps {
  isOpen: boolean;
  onClose: () => void;
}

const ProjectPicker = memo(({ isOpen, onClose }: ProjectPickerProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [connections, setConnections] = useState<RemoteConnection[]>([]);
  const [wslDistributions, setWslDistributions] = useState<WslDistribution[]>([]);
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
  const openRecentFolder = useRecentFoldersStore((state) => state.openRecentFolder);
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const handleOpenWslProject = useFileSystemStore((state) => state.handleOpenWslProject);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();

  // Load connections
  const loadConnections = useCallback(async () => {
    try {
      setConnections(await loadRemoteConnections());
    } catch (error) {
      console.error("Failed to load connections:", error);
    }
  }, []);

  const loadWslDistributions = useCallback(async () => {
    try {
      setWslDistributions(await invoke<WslDistribution[]>("wsl_list_distributions"));
    } catch {
      setWslDistributions([]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      loadConnections();
      loadWslDistributions();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, loadConnections, loadWslDistributions]);

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

  const handleOpenWslDistribution = useCallback(
    async (distribution: WslDistribution) => {
      try {
        const home = await invoke<string>("wsl_get_home_dir", { distro: distribution.name }).catch(
          () => "/",
        );
        const selectedPath = await showPromptDialog("Linux project path", {
          title: `Open ${distribution.name}`,
          defaultValue: home,
          placeholder: "/home/me/project",
          confirmLabel: "Open",
        });
        if (!selectedPath) return;

        onClose();
        await handleOpenWslProject(distribution.name, selectedPath);
      } catch (error) {
        console.error("Failed to open WSL project:", error);
        toast.error(error instanceof Error ? error.message : "Failed to open WSL project.");
      }
    },
    [handleOpenWslProject, onClose],
  );

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

  const filteredWslDistributions = useMemo(() => {
    if (!normalizedQuery) return wslDistributions;
    return wslDistributions.filter((distribution) =>
      ["wsl", distribution.name, distribution.state ?? "", String(distribution.version ?? "")].some(
        (value) => value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [normalizedQuery, wslDistributions]);

  const commandEntries = useMemo(
    () => [
      ...filteredRecentFolders.map((folder) => ({
        id: `recent:${folder.path}`,
        onSelect: () => void handleRecentFolderClick(folder),
      })),
      ...filteredConnections.map((connection) => ({
        id: `remote:${connection.id}`,
        onSelect: () => void handleConnect(connection.id),
      })),
      ...filteredWslDistributions.map((distribution) => ({
        id: `wsl:${distribution.name}`,
        onSelect: () => void handleOpenWslDistribution(distribution),
      })),
    ],
    [
      filteredConnections,
      filteredRecentFolders,
      filteredWslDistributions,
      handleOpenWslDistribution,
    ],
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
      <Command
        isVisible={isOpen}
        onClose={onClose}
        title="Open Project"
        className="athas-project-picker-command"
      >
        <CommandHeader onClose={onClose}>
          <CommandInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={handleCommandKeyDown}
            placeholder="Open project or remote connection"
          />
        </CommandHeader>
        <CommandList>
          {filteredRecentFolders.length > 0 ? (
            <div className="p-0">
              {filteredRecentFolders.map((folder) => {
                const matchingTab = projectTabs.find((t) => t.path === folder.path);
                const iconPath = folder.customIcon ?? matchingTab?.customIcon;
                const entryIndex = getEntryIndex(`recent:${folder.path}`);

                return (
                  <CommandItem
                    key={folder.path}
                    isSelected={selectedIndex === entryIndex}
                    onMouseEnter={() => setSelectedIndex(entryIndex)}
                    onClick={() => handleRecentFolderClick(folder)}
                    className={cn("px-3 py-1.5", folder.missing && "text-text-lighter")}
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
                      <WarningCircle className="shrink-0 text-warning" />
                    ) : (
                      <Folder className="shrink-0 text-text-lighter" />
                    )}
                    <div className="flex min-w-0 flex-1 items-baseline">
                      <CommandItemTitle>{folder.name}</CommandItemTitle>
                      <CommandItemMeta>{folder.path}</CommandItemMeta>
                    </div>
                    {folder.pinned ? (
                      <PushPin className="shrink-0 fill-current text-accent" />
                    ) : null}
                    {folder.missing ? (
                      <span className="shrink-0 rounded-full bg-warning/10 px-1 py-0.5 font-medium ui-text-xs text-warning">
                        Missing
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </div>
          ) : null}

          {filteredConnections.length > 0 ? (
            <div className="p-0">
              {filteredConnections.map((connection) => {
                const entryIndex = getEntryIndex(`remote:${connection.id}`);

                return (
                  <CommandItem
                    key={connection.id}
                    isSelected={selectedIndex === entryIndex}
                    onMouseEnter={() => setSelectedIndex(entryIndex)}
                    onClick={() => handleConnect(connection.id)}
                    className={cn(
                      "px-3 py-1.5",
                      connectingMap[connection.id] && "cursor-not-allowed opacity-70",
                    )}
                    disabled={!!connectingMap[connection.id]}
                  >
                    <Server className="shrink-0 text-text-lighter" />
                    <div className="flex min-w-0 flex-1 items-baseline">
                      <CommandItemTitle>{connection.name}</CommandItemTitle>
                      <CommandItemMeta>{connection.type.toUpperCase()}</CommandItemMeta>
                      <CommandItemMeta>
                        {connectingMap[connection.id]
                          ? "Connecting..."
                          : statusMap[connection.id] === "error"
                            ? "Connection failed"
                            : `${connection.username}@${connection.host}`}
                      </CommandItemMeta>
                    </div>
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        connection.isConnected ? "bg-success" : "bg-text-lighter/40",
                      )}
                    />
                    <span className="sr-only">
                      {connection.isConnected ? "Connected" : "Disconnected"}
                    </span>
                  </CommandItem>
                );
              })}
            </div>
          ) : null}

          {filteredWslDistributions.length > 0 ? (
            <div className="p-0">
              {filteredWslDistributions.map((distribution) => {
                const entryIndex = getEntryIndex(`wsl:${distribution.name}`);

                return (
                  <CommandItem
                    key={distribution.name}
                    isSelected={selectedIndex === entryIndex}
                    onMouseEnter={() => setSelectedIndex(entryIndex)}
                    onClick={() => handleOpenWslDistribution(distribution)}
                    className="px-3 py-1.5"
                  >
                    <Server className="shrink-0 text-text-lighter" />
                    <div className="flex min-w-0 flex-1 items-baseline">
                      <CommandItemTitle>{distribution.name}</CommandItemTitle>
                      <CommandItemMeta>WSL</CommandItemMeta>
                      <CommandItemMeta>
                        {distribution.state ?? "Installed"}
                        {distribution.version ? `, WSL ${distribution.version}` : ""}
                      </CommandItemMeta>
                    </div>
                    {distribution.is_default ? (
                      <span className="shrink-0 rounded-full bg-accent/10 px-1 py-0.5 font-medium ui-text-xs text-accent">
                        Default
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </div>
          ) : null}

          {filteredRecentFolders.length === 0 &&
          filteredConnections.length === 0 &&
          filteredWslDistributions.length === 0 ? (
            <CommandEmpty>
              {normalizedQuery ? `No projects match "${query}".` : "No recent projects"}
            </CommandEmpty>
          ) : null}
        </CommandList>
        <CommandFooter>
          <CommandFooterAction onClick={() => void handleOpenFolderClick()}>
            Open Folder
          </CommandFooterAction>
          <CommandFooterAction onClick={handleImportSettingsClick}>
            Import Settings
          </CommandFooterAction>
          <CommandFooterAction onClick={handleAddRemoteConnectionClick}>
            Add Remote
          </CommandFooterAction>
        </CommandFooter>
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

ProjectPicker.displayName = "ProjectPicker";

export default ProjectPicker;
