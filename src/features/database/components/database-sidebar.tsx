import {
  ArrowLeftIcon as ArrowLeft,
  DatabaseIcon as Database,
  FilePlusIcon as FilePlus,
  FolderOpenIcon as FolderOpen,
  PlugsConnectedIcon as PlugsConnected,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from "@/ui/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterAction,
  CommandHeader,
  CommandHeaderAction,
  CommandInput,
  CommandItemBadge,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import { normalizeDatabaseError } from "../lib/database-errors";
import type { DatabaseType } from "../types/provider.types";
import { PROVIDER_REGISTRY } from "../providers/provider-registry";
import { type SavedConnection, useConnectionStore } from "../stores/connection.store";
import { getDatabaseTypeForFilePath } from "../utils/database-file-drop";
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

interface DatabaseCommandContentProps {
  isActive: boolean;
  onBack: () => void;
  onClose: () => void;
}

export function DatabaseCommandContent({ isActive, onBack, onClose }: DatabaseCommandContentProps) {
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSavedConnections();
  }, [loadSavedConnections, rootFolderPath]);

  useEffect(() => {
    if (!isActive) return;
    setQuery("");
    setMode("list");
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isActive]);

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
        onClose();
      } catch (err) {
        setError(normalizeDatabaseError(err));
      } finally {
        setBusyConnectionId(null);
      }
    },
    [onClose, openDatabaseBuffer, rootFolderPath, saveConnection],
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
      onClose();
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
      onClose();
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
      onClose();
    } catch (err) {
      setError(normalizeDatabaseError(err));
    } finally {
      setBusyConnectionId(null);
    }
  };

  const openDetectedDatabase = (file: WorkspaceDatabaseFile) => {
    setError(null);
    openDatabaseBuffer(file.path, file.name, file.dbType);
    onClose();
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

  const renderHeader = () =>
    mode === "list" ? (
      <CommandHeader onClose={onClose}>
        <CommandHeaderAction type="button" onClick={onBack} aria-label="Back to commands">
          <ArrowLeft />
        </CommandHeaderAction>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Search databases"
        />
        <CommandHeaderAction type="button" onClick={showProviderStep} aria-label="Add database">
          <Plus />
        </CommandHeaderAction>
      </CommandHeader>
    ) : (
      <CommandHeader onClose={onClose}>
        <CommandHeaderAction type="button" onClick={() => setMode("list")}>
          <ArrowLeft />
          <span>Databases</span>
        </CommandHeaderAction>
        <CommandHeaderAction type="button" onClick={showProviderStep} aria-label="Add database">
          <Plus />
        </CommandHeaderAction>
      </CommandHeader>
    );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-primary-bg"
      onDrop={(event) => void handleDrop(event)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {renderHeader()}

      <CommandList>
        {mode === "choose-provider" ? (
          <>
            {installedDbTypes.length === 0 ? (
              <CommandEmpty>
                <div className="space-y-2">
                  <div>No database providers installed.</div>
                  <Button
                    type="button"
                    variant="ghost"
                    compact
                    onClick={() => {
                      useBufferStore.getState().actions.openExtensionsBuffer();
                    }}
                  >
                    Open Extensions
                  </Button>
                </div>
              </CommandEmpty>
            ) : (
              installedDbTypes.map((type) => (
                <CommandItemRow
                  key={type}
                  onClick={() => chooseProvider(type)}
                  icon={<Database className="size-4" weight="duotone" />}
                  title={PROVIDER_REGISTRY[type].label}
                />
              ))
            )}
          </>
        ) : mode === "file-provider" ? (
          <div>
            <button
              type="button"
              className={cn(
                "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary-bg/35 px-3 py-4 text-center text-text-lighter transition-colors hover:border-accent/50 hover:bg-accent/5",
                isDraggingFile && "border-accent bg-accent/10 text-text",
              )}
              onClick={() => void chooseDatabaseFile(selectedDbType)}
            >
              <FolderOpen className="size-5" weight="duotone" />
              <span className="ui-font ui-text-sm">
                Choose or drop a {PROVIDER_REGISTRY[selectedDbType].label} file
              </span>
            </button>
          </div>
        ) : mode === "network-provider" ? (
          <div className="space-y-2">
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
              <span className="ui-font text-text-lighter ui-text-sm">Save password securely</span>
            </label>
          </div>
        ) : !rootFolderPath ? (
          <CommandEmpty>Open a workspace to add databases.</CommandEmpty>
        ) : isLoadingSaved ? (
          <CommandEmpty>
            <LoadingIndicator label="Loading databases" showLabel compact />
          </CommandEmpty>
        ) : workspaceConnections.length === 0 &&
          detectedWorkspaceDatabases.length === 0 &&
          isScanningWorkspaceDatabases ? (
          <CommandEmpty>
            <LoadingIndicator label="Loading databases" showLabel compact />
          </CommandEmpty>
        ) : workspaceConnections.length === 0 && detectedWorkspaceDatabases.length === 0 ? (
          <CommandEmpty>
            {query.trim() ? "No matching databases." : "No databases in this workspace."}
          </CommandEmpty>
        ) : (
          <div className="space-y-0.5">
            {workspaceConnections.map((connection) => {
              const status = getActiveStatus(connection.id);
              const isBusy = busyConnectionId === connection.id || status === "connecting";
              return (
                <CommandItemRow
                  key={connection.id}
                  as="div"
                  className="group"
                  disabled={isBusy}
                  onClick={() => void openConnection(connection)}
                  icon={<Database className="size-4" weight="duotone" />}
                  title={connection.name}
                  description={getConnectionSubtitle(connection)}
                  accessory={
                    status === "connected" ? (
                      <CommandItemBadge>
                        <PlugsConnected className="size-3.5" weight="duotone" />
                        Connected
                      </CommandItemBadge>
                    ) : null
                  }
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      compact
                      aria-label={`Delete ${connection.name}`}
                      className={cn(
                        "size-6 shrink-0 p-0 text-text-lighter opacity-0 transition-opacity hover:text-error group-hover:opacity-100",
                        isBusy && "pointer-events-none opacity-40",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteConnection(connection.id);
                      }}
                    >
                      <Trash />
                    </Button>
                  }
                />
              );
            })}
            {detectedWorkspaceDatabases.map((file) => (
              <CommandItemRow
                key={file.id}
                onClick={() => openDetectedDatabase(file)}
                icon={<Database className="size-4" weight="duotone" />}
                title={file.name}
                description={`${PROVIDER_REGISTRY[file.dbType].label} / ${file.relativePath}`}
                accessory={<CommandItemBadge>Detected</CommandItemBadge>}
              />
            ))}
          </div>
        )}
      </CommandList>

      {mode === "network-provider" ? (
        <CommandFooter>
          <CommandFooterAction
            type="button"
            disabled={busyConnectionId !== null}
            onClick={() => void saveNetworkConnection()}
          >
            <FilePlus />
            Add Database
          </CommandFooterAction>
        </CommandFooter>
      ) : null}

      {error ? (
        <div className="border-border border-t px-2 py-1.5 text-error ui-text-sm">{error}</div>
      ) : null}

      {isDraggingFile ? (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-xl border border-accent bg-primary-bg/85 text-accent ui-text-sm backdrop-blur-sm">
          Drop database file
        </div>
      ) : null}
    </div>
  );
}
