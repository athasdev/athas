import {
  ArrowLeft,
  Database,
  FilePlus,
  FolderOpen,
  MagnifyingGlass,
  PlugsConnected,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import {
  CommandFooter,
  CommandFooterAction,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import {
  SidebarEmptyActionState,
  SidebarEmptyState,
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarHeaderSearch,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { normalizeDatabaseError } from "../lib/database-errors";
import type { DatabaseType } from "../models/provider.types";
import { PROVIDER_REGISTRY } from "../providers/provider-registry";
import { type SavedConnection, useConnectionStore } from "../stores/connection-store";
import {
  DATABASE_SIDEBAR_FILES_DROPPED_EVENT,
  getDatabaseTypeForFilePath,
} from "../utils/database-file-drop";
import {
  getDatabaseFilePathKey,
  getSavedFileConnectionPathKeys,
  getWorkspaceDatabaseFiles,
  type WorkspaceDatabaseFile,
} from "../utils/workspace-database-files";
import { buildSavedConnectionConfig } from "./connection/connection-config";
import {
  getInstalledDatabaseTypes,
  validateConnectionInput,
} from "./connection/connection-validation";

function getBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

type SidebarMode = "list" | "choose-provider" | "file-provider" | "network-provider";

function getConnectionSubtitle(connection: SavedConnection) {
  const provider = PROVIDER_REGISTRY[connection.db_type];
  if (provider.isFileBased) {
    return connection.file_path ? getBaseName(connection.file_path) : provider.label;
  }

  const database = connection.database ? ` / ${connection.database}` : "";
  return `${provider.label} ${connection.host}:${connection.port}${database}`;
}

export function DatabaseSidebar() {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const filesVersion = useFileSystemStore((state) => state.filesVersion);
  const getAllProjectFiles = useFileSystemStore((state) => state.getAllProjectFiles);
  const savedConnections = useConnectionStore.use.savedConnections();
  const activeConnections = useConnectionStore.use.activeConnections();
  const isLoadingSaved = useConnectionStore.use.isLoadingSaved();
  const {
    loadSavedConnections,
    connect,
    deleteConnection,
    getCredential,
    saveConnection,
    storeCredential,
  } = useConnectionStore.use.actions();
  const openDatabaseBuffer = useBufferStore.use.actions().openDatabaseBuffer;
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SidebarMode>("list");
  const [selectedDbType, setSelectedDbType] = useState<DatabaseType>("sqlite");
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(PROVIDER_REGISTRY.postgres.defaultPort ?? 5432);
  const [databaseName, setDatabaseName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saveCredential, setSaveCredential] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceDatabaseFiles, setWorkspaceDatabaseFiles] = useState<WorkspaceDatabaseFile[]>([]);
  const [isScanningWorkspaceDatabases, setIsScanningWorkspaceDatabases] = useState(false);

  useEffect(() => {
    void loadSavedConnections();
  }, [loadSavedConnections, rootFolderPath]);

  const installedDbTypes = useMemo(() => getInstalledDatabaseTypes(new Map()), []);
  const savedFileConnectionPathKeys = useMemo(
    () => getSavedFileConnectionPathKeys(savedConnections),
    [savedConnections],
  );

  const workspaceConnections = useMemo(() => {
    const normalizedWorkspace = rootFolderPath?.trim();
    if (!normalizedWorkspace) return [];

    const normalizedQuery = query.trim().toLowerCase();
    return savedConnections
      .filter((connection) => connection.workspace_path === normalizedWorkspace)
      .filter((connection) => {
        if (!normalizedQuery) return true;
        return (
          connection.name.toLowerCase().includes(normalizedQuery) ||
          getConnectionSubtitle(connection).toLowerCase().includes(normalizedQuery)
        );
      });
  }, [query, rootFolderPath, savedConnections]);

  const detectedWorkspaceDatabases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return workspaceDatabaseFiles
      .filter((file) => !savedFileConnectionPathKeys.has(getDatabaseFilePathKey(file.path)))
      .filter((file) => {
        if (!normalizedQuery) return true;
        const providerLabel = PROVIDER_REGISTRY[file.dbType].label.toLowerCase();
        return (
          file.name.toLowerCase().includes(normalizedQuery) ||
          file.relativePath.toLowerCase().includes(normalizedQuery) ||
          providerLabel.includes(normalizedQuery)
        );
      });
  }, [query, savedFileConnectionPathKeys, workspaceDatabaseFiles]);

  useEffect(() => {
    if (!rootFolderPath) {
      setWorkspaceDatabaseFiles([]);
      setIsScanningWorkspaceDatabases(false);
      return;
    }

    let isCurrent = true;
    setIsScanningWorkspaceDatabases(true);
    void getAllProjectFiles()
      .then((files) => {
        if (!isCurrent) return;
        setWorkspaceDatabaseFiles(
          getWorkspaceDatabaseFiles(files, rootFolderPath, savedFileConnectionPathKeys),
        );
      })
      .catch((err) => {
        if (!isCurrent) return;
        console.warn("Failed to scan workspace database files", err);
        setWorkspaceDatabaseFiles([]);
      })
      .finally(() => {
        if (isCurrent) setIsScanningWorkspaceDatabases(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [filesVersion, getAllProjectFiles, rootFolderPath, savedFileConnectionPathKeys]);

  const getActiveStatus = (connectionId: string) =>
    activeConnections.find((connection) => connection.id === connectionId)?.status;

  const resetAddForm = (dbType: DatabaseType = selectedDbType) => {
    const provider = PROVIDER_REGISTRY[dbType];
    setName("");
    setHost("localhost");
    setPort(provider.defaultPort ?? 5432);
    setDatabaseName("");
    setUsername("");
    setPassword("");
    setSaveCredential(false);
    setError(null);
  };

  const showProviderStep = () => {
    resetAddForm();
    setMode("choose-provider");
  };

  const chooseProvider = (dbType: DatabaseType) => {
    setSelectedDbType(dbType);
    resetAddForm(dbType);
    setMode(PROVIDER_REGISTRY[dbType].isFileBased ? "file-provider" : "network-provider");
  };

  const saveFileConnection = useCallback(
    async (filePath: string, dbType = getDatabaseTypeForFilePath(filePath)) => {
      if (!rootFolderPath) {
        setError("Open a workspace before adding databases.");
        return;
      }

      if (!dbType) {
        setError("Drop a SQLite or DuckDB database file.");
        return;
      }

      const fileName = getBaseName(filePath);
      const config = buildSavedConnectionConfig({
        dbType,
        mode: "form",
        name: fileName,
        host: "",
        port: 0,
        database: "",
        username: "",
        connectionString: "",
        filePath,
        workspacePath: rootFolderPath,
      });

      setBusyConnectionId(config.id);
      setError(null);
      try {
        await saveConnection(config);
        openDatabaseBuffer(filePath, config.name, dbType);
        setMode("list");
      } catch (err) {
        setError(normalizeDatabaseError(err));
      } finally {
        setBusyConnectionId(null);
      }
    },
    [openDatabaseBuffer, rootFolderPath, saveConnection],
  );

  const chooseDatabaseFile = async (dbType: DatabaseType) => {
    const provider = PROVIDER_REGISTRY[dbType];
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: provider.label,
          extensions: (provider.fileExtensions ?? []).map((extension) =>
            extension.replace(/^\./, ""),
          ),
        },
      ],
    });

    if (selected && typeof selected === "string") {
      await saveFileConnection(selected, dbType);
    }
  };

  const saveNetworkConnection = async () => {
    if (!rootFolderPath) {
      setError("Open a workspace before adding databases.");
      return;
    }

    const validationError = validateConnectionInput({
      dbType: selectedDbType,
      isFileBased: false,
      mode: "form",
      filePath: "",
      host,
      port,
      database: databaseName,
      connectionString: "",
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const config = buildSavedConnectionConfig({
      dbType: selectedDbType,
      mode: "form",
      name,
      host,
      port,
      database: databaseName,
      username,
      connectionString: "",
      filePath: "",
      workspacePath: rootFolderPath,
    });

    setBusyConnectionId(config.id);
    setError(null);
    try {
      if (saveCredential && password) {
        await storeCredential(config.id, password);
      }
      await saveConnection(config);
      const connectionId = await connect(config, password || undefined);
      openDatabaseBuffer(`connection://${connectionId}`, config.name, selectedDbType, connectionId);
      setMode("list");
    } catch (err) {
      setError(normalizeDatabaseError(err));
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
    const droppedPaths = extractDroppedFilePaths(event.dataTransfer);
    const databasePath = droppedPaths.find((path) => getDatabaseTypeForFilePath(path));
    if (!databasePath) {
      setError("Drop a SQLite or DuckDB database file.");
      return;
    }

    await saveFileConnection(databasePath);
  };

  useEffect(() => {
    const handleNativeDatabaseDrop = (event: Event) => {
      const paths = (event as CustomEvent<{ paths?: string[] }>).detail?.paths ?? [];
      const databasePath = paths.find((path) => getDatabaseTypeForFilePath(path));
      if (databasePath) {
        void saveFileConnection(databasePath);
      }
    };

    window.addEventListener(DATABASE_SIDEBAR_FILES_DROPPED_EVENT, handleNativeDatabaseDrop);
    return () => {
      window.removeEventListener(DATABASE_SIDEBAR_FILES_DROPPED_EVENT, handleNativeDatabaseDrop);
    };
  }, [saveFileConnection]);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFile(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDraggingFile(false);
  };

  const openConnection = async (connection: SavedConnection) => {
    const provider = PROVIDER_REGISTRY[connection.db_type];
    setError(null);

    if (provider.isFileBased) {
      if (!connection.file_path) {
        setError("Database file path is missing.");
        return;
      }

      openDatabaseBuffer(connection.file_path, connection.name, connection.db_type);
      return;
    }

    setBusyConnectionId(connection.id);
    try {
      const status = getActiveStatus(connection.id);
      const connectionId =
        status === "connected"
          ? connection.id
          : await connect(connection, (await getCredential(connection.id)) ?? undefined);
      openDatabaseBuffer(
        `connection://${connectionId}`,
        connection.name,
        connection.db_type,
        connectionId,
      );
    } catch (err) {
      setError(normalizeDatabaseError(err));
    } finally {
      setBusyConnectionId(null);
    }
  };

  const openDetectedDatabase = (file: WorkspaceDatabaseFile) => {
    setError(null);
    openDatabaseBuffer(file.path, file.name, file.dbType);
  };

  const handleDeleteConnection = async (connectionId: string) => {
    setError(null);
    setBusyConnectionId(connectionId);
    try {
      await deleteConnection(connectionId);
    } catch (err) {
      setError(normalizeDatabaseError(err));
    } finally {
      setBusyConnectionId(null);
    }
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-primary-bg"
      onDrop={(event) => void handleDrop(event)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <SidebarHeader>
        {mode === "list" ? (
          <SidebarHeaderSearch
            value={query}
            onChange={setQuery}
            leftIcon={MagnifyingGlass}
            placeholder="Search"
            aria-label="Search databases"
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            compact
            className="h-6 min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1.5 text-text-lighter"
            onClick={() => setMode("list")}
          >
            <ArrowLeft />
            <span className="ui-font truncate ui-text-xs">Databases</span>
          </Button>
        )}
        <SidebarHeaderIconButton
          tooltip="Add Database"
          tooltipSide="bottom"
          onClick={showProviderStep}
        >
          <Plus />
        </SidebarHeaderIconButton>
      </SidebarHeader>

      <div className="custom-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
        {mode === "choose-provider" ? (
          <CommandList>
            {installedDbTypes.length === 0 ? (
              <SidebarEmptyActionState
                className="min-h-0"
                message="No database providers installed."
                actionLabel="Open Extensions"
                onAction={() => openSettingsDialog("extensions")}
              />
            ) : (
              installedDbTypes.map((type) => (
                <CommandItem key={type} onClick={() => chooseProvider(type)}>
                  <Database className="size-4 shrink-0 text-text-lighter" weight="duotone" />
                  <span className="ui-font ui-text-xs text-text">
                    {PROVIDER_REGISTRY[type].label}
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        ) : mode === "file-provider" ? (
          <div className="p-1">
            <button
              type="button"
              className={cn(
                "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-secondary-bg/35 px-3 py-4 text-center text-text-lighter transition-colors hover:border-accent/50 hover:bg-accent/5",
                isDraggingFile && "border-accent bg-accent/10 text-text",
              )}
              onClick={() => void chooseDatabaseFile(selectedDbType)}
            >
              <FolderOpen className="size-5" weight="duotone" />
              <span className="ui-font ui-text-xs">
                Choose or drop a {PROVIDER_REGISTRY[selectedDbType].label} file
              </span>
            </button>
          </div>
        ) : mode === "network-provider" ? (
          <CommandList>
            <div className="space-y-2 p-2">
              <CommandInput
                value={name}
                onChange={setName}
                placeholder={`${PROVIDER_REGISTRY[selectedDbType].label} connection`}
                className="h-7 rounded-md bg-secondary-bg px-2"
              />
              <div className="flex gap-2">
                <Input
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="Host"
                  className="h-7 flex-1"
                />
                <Input
                  type="number"
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value))}
                  placeholder="Port"
                  className="h-7 w-20"
                />
              </div>
              {selectedDbType !== "redis" ? (
                <Input
                  value={databaseName}
                  onChange={(event) => setDatabaseName(event.target.value)}
                  placeholder="Database"
                  className="h-7"
                />
              ) : null}
              <div className="flex gap-2">
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Username"
                  className="h-7 flex-1"
                />
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  className="h-7 flex-1"
                />
              </div>
              <label
                htmlFor="database-sidebar-save-password"
                className="flex items-center gap-2 px-1"
              >
                <Checkbox
                  id="database-sidebar-save-password"
                  checked={saveCredential}
                  onChange={setSaveCredential}
                  ariaLabel="Save password securely"
                />
                <span className="ui-font text-text-lighter ui-text-xs">Save password securely</span>
              </label>
            </div>
          </CommandList>
        ) : !rootFolderPath ? (
          <SidebarEmptyState>Open a workspace to add databases.</SidebarEmptyState>
        ) : isLoadingSaved ? (
          <SidebarEmptyState>
            <LoadingIndicator label="Loading databases" showLabel compact />
          </SidebarEmptyState>
        ) : workspaceConnections.length === 0 &&
          detectedWorkspaceDatabases.length === 0 &&
          isScanningWorkspaceDatabases ? (
          <SidebarEmptyState>
            <LoadingIndicator label="Loading databases" showLabel compact />
          </SidebarEmptyState>
        ) : workspaceConnections.length === 0 && detectedWorkspaceDatabases.length === 0 ? (
          <SidebarEmptyState>
            {query.trim() ? "No matching databases." : "No databases in this workspace."}
          </SidebarEmptyState>
        ) : (
          <div className="space-y-0.5">
            {workspaceConnections.map((connection) => {
              const status = getActiveStatus(connection.id);
              const isBusy = busyConnectionId === connection.id || status === "connecting";
              return (
                <div
                  key={connection.id}
                  className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                >
                  <Database className="size-4 shrink-0 text-text-lighter" weight="duotone" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void openConnection(connection)}
                    disabled={isBusy}
                  >
                    <div className="ui-font truncate text-text ui-text-xs">{connection.name}</div>
                    <div className="ui-font truncate ui-text-xs text-text-lighter">
                      {getConnectionSubtitle(connection)}
                    </div>
                  </button>
                  {status === "connected" ? (
                    <PlugsConnected className="size-3.5 shrink-0 text-accent" weight="duotone" />
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    compact
                    aria-label={`Delete ${connection.name}`}
                    className={cn(
                      "size-6 shrink-0 p-0 text-text-lighter opacity-0 transition-opacity hover:text-error group-hover:opacity-100",
                      isBusy && "pointer-events-none opacity-40",
                    )}
                    onClick={() => void handleDeleteConnection(connection.id)}
                  >
                    <Trash />
                  </Button>
                </div>
              );
            })}
            {detectedWorkspaceDatabases.map((file) => (
              <div
                key={file.id}
                className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
              >
                <Database className="size-4 shrink-0 text-text-lighter" weight="duotone" />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openDetectedDatabase(file)}
                >
                  <div className="ui-font truncate text-text ui-text-xs">{file.name}</div>
                  <div className="ui-font truncate ui-text-xs text-text-lighter">
                    {PROVIDER_REGISTRY[file.dbType].label} / {file.relativePath}
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {mode === "network-provider" ? (
        <CommandFooter>
          <CommandFooterAction
            type="button"
            variant="default"
            className="w-full justify-center gap-1.5"
            disabled={busyConnectionId !== null}
            onClick={() => void saveNetworkConnection()}
          >
            <FilePlus />
            Add Database
          </CommandFooterAction>
        </CommandFooter>
      ) : null}

      {error ? (
        <div className="border-border border-t px-2 py-1.5 text-error ui-text-xs">{error}</div>
      ) : null}

      {isDraggingFile ? (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border border-accent bg-primary-bg/85 text-accent ui-text-xs backdrop-blur-sm">
          Drop database file
        </div>
      ) : null}
    </div>
  );
}
