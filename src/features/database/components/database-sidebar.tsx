import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  PlugsConnectedIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@/ui/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { extractDroppedFilePaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { DatabaseBrandMark } from "@/ui/brand-marks";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { EmptyState } from "@/ui/empty";
import { Field, FieldLabel, FieldSet, FieldLegend, FieldDescription } from "@/ui/field";
import {
  SidebarPanel,
  SidebarHeader,
  SidebarFilterBar,
  SidebarScrollArea,
  SidebarIconButton,
  SidebarListItem,
  SidebarListActionRow,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
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
import { buildSavedConnectionConfig } from "../utils/connection-config";
import { getInstalledDatabaseTypes, validateConnectionInput } from "../utils/connection-validation";

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
  const activeDatabasePath = useBufferStore((state) => {
    const buffer = state.buffers.find((item) => item.id === state.activeBufferId);
    return buffer?.type === "database" ? buffer.path : undefined;
  });
  const [query, setQuery] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
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
    setProviderQuery("");
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

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
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

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFile(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
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

  const hasWorkspaceDatabases =
    Boolean(rootFolderPath) &&
    (savedConnections.some((connection) => connection.workspace_path === rootFolderPath?.trim()) ||
      workspaceDatabaseFiles.some(
        (file) => !savedFileConnectionPathKeys.has(getDatabaseFilePathKey(file.path)),
      ));
  const isLoadingDatabases = isLoadingSaved || isScanningWorkspaceDatabases;
  const showProviders =
    mode === "choose-provider" ||
    (mode === "list" && Boolean(rootFolderPath) && !hasWorkspaceDatabases && !isLoadingDatabases);
  const filterQuery = mode === "choose-provider" ? providerQuery : query;
  const setFilterQuery = mode === "choose-provider" ? setProviderQuery : setQuery;
  const visibleProviders = installedDbTypes.filter(
    (type) =>
      !hasWorkspaceDatabases ||
      mode === "list" ||
      PROVIDER_REGISTRY[type].label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );
  const backButton = (
    <SidebarIconButton
      aria-label={mode === "choose-provider" ? "Back to databases" : "Back to database providers"}
      tooltip={mode === "choose-provider" ? "Back to databases" : "Back to database providers"}
      onClick={() => {
        setMode(mode === "choose-provider" || !hasWorkspaceDatabases ? "list" : "choose-provider");
        setError(null);
      }}
    >
      <ArrowLeftIcon />
    </SidebarIconButton>
  );

  return (
    <SidebarPanel
      className="relative"
      onDrop={(event) => void handleDrop(event)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {(mode === "list" || mode === "choose-provider") && hasWorkspaceDatabases ? (
        <SidebarFilterBar
          ref={filterInputRef}
          value={filterQuery}
          onChange={setFilterQuery}
          aria-label={mode === "list" ? "Filter databases" : "Filter providers"}
          placeholder={mode === "list" ? "Filter databases" : "Filter providers"}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setFilterQuery("");
            }
          }}
          leading={mode === "choose-provider" ? backButton : undefined}
          actionsLabel="Database controls"
          actions={
            <>
              {filterQuery ? (
                <SidebarIconButton
                  aria-label="Clear filter"
                  tooltip="Clear filter"
                  onClick={() => {
                    setFilterQuery("");
                    filterInputRef.current?.focus();
                  }}
                >
                  <XIcon />
                </SidebarIconButton>
              ) : null}
              {mode === "list" ? (
                <SidebarIconButton
                  onClick={showProviderStep}
                  aria-label="Add database"
                  tooltip="Add database"
                  disabled={!rootFolderPath || busyConnectionId !== null}
                >
                  <PlusIcon />
                </SidebarIconButton>
              ) : null}
            </>
          }
        />
      ) : (
        <SidebarHeader>
          {mode === "file-provider" || mode === "network-provider" ? (
            <>
              {backButton}
              <DatabaseBrandMark provider={selectedDbType} />
              <span className="truncate">{PROVIDER_REGISTRY[selectedDbType].label}</span>
            </>
          ) : (
            <span className="truncate">{showProviders ? "Add database" : "Databases"}</span>
          )}
        </SidebarHeader>
      )}
      <SidebarScrollArea>
        {showProviders ? (
          installedDbTypes.length === 0 ? (
            <EmptyState
              layout="sidebar"
              message="No database providers installed."
              action={{
                label: "Open Integrations",
                onClick: () => useBufferStore.getState().actions.openExtensionsBuffer(),
              }}
            />
          ) : visibleProviders.length === 0 ? (
            <EmptyState layout="sidebar" message="No matching providers." />
          ) : (
            visibleProviders.map((type) => (
              <SidebarListItem
                key={type}
                density="comfortable"
                disabled={busyConnectionId !== null}
                onClick={() => chooseProvider(type)}
                leading={<DatabaseBrandMark provider={type} size="1.5em" />}
                trailing={<ChevronRightIcon />}
              >
                {PROVIDER_REGISTRY[type].label}
              </SidebarListItem>
            ))
          )
        ) : mode === "file-provider" ? (
          <div className="flex flex-col gap-4 px-2 py-2">
            <FieldDescription>
              Open an existing {PROVIDER_REGISTRY[selectedDbType].label} database. Choose a file or
              drop it into this sidebar.
            </FieldDescription>
            <Button
              variant="accent"
              width="full"
              disabled={busyConnectionId !== null}
              onClick={() =>
                void chooseDatabaseFile(selectedDbType).catch((err) =>
                  setError(normalizeDatabaseError(err)),
                )
              }
            >
              <FolderOpenIcon />
              {busyConnectionId ? "Opening…" : "Choose database file"}
            </Button>
          </div>
        ) : mode === "network-provider" ? (
          <form
            aria-label={`${PROVIDER_REGISTRY[selectedDbType].label} connection`}
            className="flex min-w-0 flex-col gap-6 px-2 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busyConnectionId) void saveNetworkConnection();
            }}
          >
            <FieldSet disabled={busyConnectionId !== null}>
              <Field>
                <FieldLabel htmlFor="database-sidebar-name">Connection name</FieldLabel>
                <Input
                  id="database-sidebar-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`${PROVIDER_REGISTRY[selectedDbType].label} connection`}
                />
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="database-sidebar-host">Host</FieldLabel>
                  <Input
                    id="database-sidebar-host"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="database-sidebar-port">Port</FieldLabel>
                  <Input
                    id="database-sidebar-port"
                    type="number"
                    value={port}
                    onChange={(event) => setPort(Number(event.target.value))}
                  />
                </Field>
              </div>
              {selectedDbType !== "redis" ? (
                <Field>
                  <FieldLabel htmlFor="database-sidebar-database">Database</FieldLabel>
                  <Input
                    id="database-sidebar-database"
                    value={databaseName}
                    onChange={(event) => setDatabaseName(event.target.value)}
                  />
                </Field>
              ) : null}
            </FieldSet>
            <FieldSet disabled={busyConnectionId !== null}>
              <FieldLegend variant="label">Authentication</FieldLegend>
              <Field>
                <FieldLabel htmlFor="database-sidebar-username">Username</FieldLabel>
                <Input
                  id="database-sidebar-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="database-sidebar-password">Password</FieldLabel>
                <Input
                  id="database-sidebar-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="database-sidebar-save-password"
                  checked={saveCredential}
                  onCheckedChange={setSaveCredential}
                />
                <FieldLabel htmlFor="database-sidebar-save-password">
                  Save password securely
                </FieldLabel>
              </Field>
            </FieldSet>
            <Button
              type="submit"
              variant="accent"
              width="full"
              disabled={busyConnectionId !== null}
            >
              {busyConnectionId ? "Connecting…" : "Add database"}
            </Button>
          </form>
        ) : !rootFolderPath ? (
          <EmptyState layout="sidebar" message="Open a workspace to add databases." />
        ) : isLoadingSaved ||
          (workspaceConnections.length === 0 &&
            detectedWorkspaceDatabases.length === 0 &&
            isScanningWorkspaceDatabases) ? (
          <EmptyState
            layout="sidebar"
            message={<Spinner label="Loading databases" showLabel compact />}
          />
        ) : workspaceConnections.length === 0 && detectedWorkspaceDatabases.length === 0 ? (
          <EmptyState
            layout="sidebar"
            message="No matching databases."
            action={{
              label: "Add database",
              icon: <PlusIcon />,
              onClick: showProviderStep,
              disabled: busyConnectionId !== null,
            }}
          />
        ) : (
          <>
            {workspaceConnections.length > 0 ? (
              <SidebarSectionLabel>Connections</SidebarSectionLabel>
            ) : null}
            {workspaceConnections.map((connection) => {
              const status = getActiveStatus(connection.id);
              const isBusy = busyConnectionId === connection.id || status === "connecting";
              const isActive =
                activeDatabasePath === (connection.file_path || `connection://${connection.id}`);
              return (
                <SidebarListActionRow
                  key={connection.id}
                  data-active={isActive}
                  actions={
                    <SidebarIconButton
                      tone="danger"
                      tooltip={`Delete ${connection.name}`}
                      aria-label={`Delete ${connection.name}`}
                      disabled={isBusy}
                      onClick={() => void handleDeleteConnection(connection.id)}
                    >
                      <TrashIcon />
                    </SidebarIconButton>
                  }
                >
                  <SidebarListItem
                    active={isActive}
                    disabled={isBusy}
                    onClick={() => void openConnection(connection)}
                    leading={
                      isBusy ? (
                        <Spinner compact />
                      ) : (
                        <DatabaseBrandMark provider={connection.db_type} />
                      )
                    }
                    description={getConnectionSubtitle(connection)}
                    trailing={
                      status === "connected" ? (
                        <PlugsConnectedIcon aria-label="Connected" />
                      ) : undefined
                    }
                  >
                    {connection.name}
                  </SidebarListItem>
                </SidebarListActionRow>
              );
            })}
            {detectedWorkspaceDatabases.length > 0 ? (
              <SidebarSectionLabel>Detected in workspace</SidebarSectionLabel>
            ) : null}
            {detectedWorkspaceDatabases.map((file) => (
              <SidebarListItem
                key={file.id}
                active={activeDatabasePath === file.path}
                onClick={() => openDetectedDatabase(file)}
                leading={<DatabaseBrandMark provider={file.dbType} />}
                description={`${PROVIDER_REGISTRY[file.dbType].label} / ${file.relativePath}`}
              >
                {file.name}
              </SidebarListItem>
            ))}
          </>
        )}
        {error ? (
          <p role="alert" className="px-2 py-1.5 text-destructive ui-text-sm">
            {error}
          </p>
        ) : null}
      </SidebarScrollArea>
      {isDraggingFile ? (
        <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-xl border border-primary bg-background text-primary ui-text-sm backdrop-blur-sm">
          Drop database file
        </div>
      ) : null}
    </SidebarPanel>
  );
}
