import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon as FolderOpen, PlugsConnectedIcon as PlugZap } from "@/ui/icons";
import { useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import Select from "@/ui/select";
import { Tab, TabsList } from "@/ui/tabs";
import { normalizeDatabaseError } from "../../lib/database-errors";
import type { DatabaseType } from "../../types/provider.types";
import { PROVIDER_REGISTRY } from "../../providers/provider-registry";
import { useConnectionStore } from "../../stores/connection.store";
import { buildSavedConnectionConfig } from "./connection-config";
import { getInstalledDatabaseTypes, validateConnectionInput } from "./connection-validation";

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ConnectionDialog({ isOpen, onClose }: ConnectionDialogProps) {
  const { actions } = useConnectionStore();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const availableExtensions = useExtensionStore.use.availableExtensions();
  const [mode, setMode] = useState<"form" | "string">("form");
  const [dbType, setDbType] = useState<DatabaseType>("sqlite");
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(PROVIDER_REGISTRY.sqlite.defaultPort ?? 5432);
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [saveCredential, setSaveCredential] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const connectionFeedbackVersionRef = useRef(0);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const installedDbTypes = getInstalledDatabaseTypes(availableExtensions);

  useEffect(() => {
    if (!isOpen || installedDbTypes.length === 0 || installedDbTypes.includes(dbType)) {
      return;
    }

    handleDbTypeChange(installedDbTypes[0]);
  }, [dbType, installedDbTypes, isOpen]);

  if (!isOpen) return null;

  const provider = PROVIDER_REGISTRY[dbType];
  const isFileBased = provider.isFileBased;
  const validationError = validateConnectionInput({
    dbType,
    isFileBased,
    mode,
    filePath,
    host,
    port,
    database,
    connectionString,
  });

  const clearConnectionFeedback = () => {
    connectionFeedbackVersionRef.current += 1;
    setIsTesting(false);
    setError(null);
    setTestResult(null);
  };

  const updateConnectionField = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    clearConnectionFeedback();
  };

  const handleModeChange = (nextMode: "form" | "string") => {
    if (mode === nextMode) return;
    setMode(nextMode);
    clearConnectionFeedback();
  };

  const handleDbTypeChange = (type: DatabaseType) => {
    setDbType(type);
    setPort(PROVIDER_REGISTRY[type].defaultPort ?? 5432);
    if (PROVIDER_REGISTRY[type].isFileBased) {
      setMode("form");
    }
    clearConnectionFeedback();
  };

  const buildConfig = () =>
    buildSavedConnectionConfig({
      dbType,
      mode,
      name,
      filePath,
      host,
      port,
      database,
      username,
      connectionString,
      workspacePath: rootFolderPath,
    });

  const handleBrowseDatabaseFile = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: provider.label,
          extensions: (provider.fileExtensions ?? []).map((ext) => ext.replace(/^\./, "")),
        },
      ],
    });

    if (selected && typeof selected === "string") {
      setFilePath(selected);
      if (!name.trim()) {
        const fileName = selected.split("/").pop() ?? selected;
        setName(fileName);
      }
      clearConnectionFeedback();
    }
  };

  const handleTest = async () => {
    if (isFileBased) return;
    if (validationError) {
      connectionFeedbackVersionRef.current += 1;
      setError(validationError);
      setTestResult(false);
      return;
    }
    const feedbackVersion = connectionFeedbackVersionRef.current + 1;
    connectionFeedbackVersionRef.current = feedbackVersion;
    setIsTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await actions.testConnection(buildConfig(), password || undefined);
      if (connectionFeedbackVersionRef.current !== feedbackVersion) return;
      setTestResult(result.ok);
      if (!result.ok) setError(result.error ?? "Connection test failed");
    } catch (err) {
      if (connectionFeedbackVersionRef.current !== feedbackVersion) return;
      setError(normalizeDatabaseError(err));
      setTestResult(false);
    } finally {
      if (connectionFeedbackVersionRef.current === feedbackVersion) {
        setIsTesting(false);
      }
    }
  };

  const handleConnect = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsConnecting(true);
    setError(null);
    try {
      if (isFileBased) {
        const config = buildConfig();
        await actions.saveConnection(config);
        useBufferStore
          .getState()
          .actions.openDatabaseBuffer(config.file_path ?? filePath, config.name, dbType);
        onClose();
        return;
      }

      const config = buildConfig();

      if (saveCredential && password) {
        await actions.storeCredential(config.id, password);
      }

      await actions.saveConnection(config);
      const connId = await actions.connect(config, password || undefined);
      useBufferStore
        .getState()
        .actions.openDatabaseBuffer(`connection://${connId}`, config.name, dbType, connId);
      onClose();
    } catch (err) {
      setError(normalizeDatabaseError(err));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      title="Connect to Database"
      headerBorder={false}
      footerBorder={false}
      classNames={{
        backdrop: "bg-black/40 backdrop-blur-[2px]",
        modal: "max-w-md",
        content: "space-y-4",
      }}
      footer={
        <>
          {installedDbTypes.length > 0 && !isFileBased && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleTest}
              disabled={isTesting || isConnecting}
              className="gap-1.5"
              aria-label="Test connection"
              compact
            >
              {isTesting ? <LoadingIndicator label="Testing" compact /> : <PlugZap />}
              Test
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConnect}
            disabled={installedDbTypes.length === 0 || isConnecting || validationError !== null}
            className="gap-1.5"
            aria-label={isFileBased ? "Open database" : "Connect"}
            compact
          >
            {isConnecting && <LoadingIndicator label="Connecting" compact />}
            {isFileBased ? "Open Database" : "Connect"}
          </Button>
        </>
      }
    >
      {installedDbTypes.length === 0 ? (
        <div className="rounded-lg border border-border bg-secondary-bg/35 px-3 py-2 text-text-lighter ui-text-sm">
          Install a database provider from Settings &gt; Extensions to connect to databases.
        </div>
      ) : null}

      <Select
        value={dbType}
        onChange={(value) => handleDbTypeChange(value as DatabaseType)}
        options={installedDbTypes.map((type) => ({
          value: type,
          label: PROVIDER_REGISTRY[type].label,
        }))}
        variant="default"
        className="w-full"
        menuClassName="z-[10040]"
      />

      <TabsList variant="default" className="grid grid-cols-2">
        <Tab
          role="tab"
          aria-selected={mode === "form"}
          aria-label="Form mode"
          isActive={mode === "form"}
          size="sm"
          variant="default"
          onClick={() => handleModeChange("form")}
        >
          Form
        </Tab>
        <Tab
          role="tab"
          aria-selected={mode === "string"}
          aria-label="Connection string mode"
          isActive={mode === "string"}
          size="sm"
          variant="default"
          onClick={() => !isFileBased && handleModeChange("string")}
          className={isFileBased ? "pointer-events-none opacity-50" : undefined}
        >
          Connection String
        </Tab>
      </TabsList>

      {mode === "form" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="db-conn-name" className="ui-font block ui-text-sm text-text">
              Connection Name
            </label>
            <Input
              id="db-conn-name"
              className="w-full"
              placeholder={`My ${PROVIDER_REGISTRY[dbType].label}`}
              value={name}
              onChange={(e) => updateConnectionField(setName, e.target.value)}
            />
          </div>

          {isFileBased ? (
            <div className="space-y-1">
              <label htmlFor="db-conn-file" className="ui-font block ui-text-sm text-text">
                Database File
              </label>
              <div className="flex gap-2">
                <Input
                  id="db-conn-file"
                  className="w-full"
                  value={filePath}
                  onChange={(e) => updateConnectionField(setFilePath, e.target.value)}
                  placeholder="Select a SQLite database file"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={handleBrowseDatabaseFile}
                  compact
                >
                  <FolderOpen />
                  Browse
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label htmlFor="db-conn-host" className="ui-font block ui-text-sm text-text">
                    Host
                  </label>
                  <Input
                    id="db-conn-host"
                    className="w-full"
                    value={host}
                    onChange={(e) => updateConnectionField(setHost, e.target.value)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label htmlFor="db-conn-port" className="ui-font block ui-text-sm text-text">
                    Port
                  </label>
                  <Input
                    id="db-conn-port"
                    type="number"
                    className="w-full"
                    value={port}
                    onChange={(e) => updateConnectionField(setPort, Number(e.target.value))}
                  />
                </div>
              </div>
              {dbType !== "redis" && (
                <div className="space-y-1">
                  <label htmlFor="db-conn-database" className="ui-font block ui-text-sm text-text">
                    Database
                  </label>
                  <Input
                    id="db-conn-database"
                    className="w-full"
                    value={database}
                    onChange={(e) => updateConnectionField(setDatabase, e.target.value)}
                  />
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label htmlFor="db-conn-username" className="ui-font block ui-text-sm text-text">
                    Username
                  </label>
                  <Input
                    id="db-conn-username"
                    className="w-full"
                    value={username}
                    onChange={(e) => updateConnectionField(setUsername, e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label htmlFor="db-conn-password" className="ui-font block ui-text-sm text-text">
                    Password
                  </label>
                  <Input
                    id="db-conn-password"
                    type="password"
                    className="w-full"
                    value={password}
                    onChange={(e) => updateConnectionField(setPassword, e.target.value)}
                  />
                </div>
              </div>
              <label htmlFor="db-conn-save-password" className="flex items-center gap-2">
                <Checkbox
                  id="db-conn-save-password"
                  checked={saveCredential}
                  onChange={(checked) => updateConnectionField(setSaveCredential, checked)}
                  ariaLabel="Save password securely"
                />
                <span className="ui-font text-text-lighter ui-text-sm">Save password securely</span>
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="db-conn-string" className="ui-font block ui-text-sm text-text">
            Connection String
          </label>
          <Input
            id="db-conn-string"
            className="w-full"
            placeholder={`${dbType}://user:pass@host:port/database`}
            value={connectionString}
            onChange={(e) => updateConnectionField(setConnectionString, e.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-error ui-text-sm">
          {error}
        </div>
      )}

      {testResult === true && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-success ui-text-sm">
          Connection test successful
        </div>
      )}
    </Dialog>
  );
}
