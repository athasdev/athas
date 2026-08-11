import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon as FolderOpen, PlugsConnectedIcon as PlugZap } from "@/ui/icons";
import { useEffect, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useExtensionStore } from "@/extensions/registry/extension-store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import { Field, FieldLabel } from "@/ui/field";
import Input from "@/ui/input";
import { Marker, MarkerContent } from "@/ui/marker";
import { Spinner } from "@/ui/spinner";
import Select from "@/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
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
  const actions = useConnectionStore.use.actions();
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
              size="xs"
            >
              {isTesting ? <Spinner label="Testing" compact /> : <PlugZap />}
              Test
            </Button>
          )}
          <Button
            type="button"
            onClick={handleConnect}
            disabled={installedDbTypes.length === 0 || isConnecting || validationError !== null}
            className="gap-1.5"
            aria-label={isFileBased ? "Open database" : "Connect"}
            size="xs"
          >
            {isConnecting && <Spinner label="Connecting" compact />}
            {isFileBased ? "Open Database" : "Connect"}
          </Button>
        </>
      }
    >
      {installedDbTypes.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface/35 px-3 py-2 text-subtle-foreground ui-text-sm">
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
        menuClassName="z-10040"
      />

      <Tabs value={mode} onValueChange={(value) => handleModeChange(value as "form" | "string")}>
        <TabsList variant="default" className="grid w-full grid-cols-2">
          <TabsTrigger value="form" aria-label="Form mode">
            Form
          </TabsTrigger>
          <TabsTrigger value="string" aria-label="Connection string mode" disabled={isFileBased}>
            Connection String
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "form" ? (
        <div className="space-y-3">
          <Field>
            <FieldLabel htmlFor="db-conn-name">Connection Name</FieldLabel>
            <Input
              id="db-conn-name"
              className="w-full"
              placeholder={`My ${PROVIDER_REGISTRY[dbType].label}`}
              value={name}
              onChange={(e) => updateConnectionField(setName, e.target.value)}
            />
          </Field>

          {isFileBased ? (
            <Field>
              <FieldLabel htmlFor="db-conn-file">Database File</FieldLabel>
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
                  size="xs"
                >
                  <FolderOpen />
                  Browse
                </Button>
              </div>
            </Field>
          ) : (
            <>
              <div className="flex gap-3">
                <Field className="flex-1">
                  <FieldLabel htmlFor="db-conn-host">Host</FieldLabel>
                  <Input
                    id="db-conn-host"
                    className="w-full"
                    value={host}
                    onChange={(e) => updateConnectionField(setHost, e.target.value)}
                  />
                </Field>
                <Field className="w-24">
                  <FieldLabel htmlFor="db-conn-port">Port</FieldLabel>
                  <Input
                    id="db-conn-port"
                    type="number"
                    className="w-full"
                    value={port}
                    onChange={(e) => updateConnectionField(setPort, Number(e.target.value))}
                  />
                </Field>
              </div>
              {dbType !== "redis" && (
                <Field>
                  <FieldLabel htmlFor="db-conn-database">Database</FieldLabel>
                  <Input
                    id="db-conn-database"
                    className="w-full"
                    value={database}
                    onChange={(e) => updateConnectionField(setDatabase, e.target.value)}
                  />
                </Field>
              )}
              <div className="flex gap-3">
                <Field className="flex-1">
                  <FieldLabel htmlFor="db-conn-username">Username</FieldLabel>
                  <Input
                    id="db-conn-username"
                    className="w-full"
                    value={username}
                    onChange={(e) => updateConnectionField(setUsername, e.target.value)}
                  />
                </Field>
                <Field className="flex-1">
                  <FieldLabel htmlFor="db-conn-password">Password</FieldLabel>
                  <Input
                    id="db-conn-password"
                    type="password"
                    className="w-full"
                    value={password}
                    onChange={(e) => updateConnectionField(setPassword, e.target.value)}
                  />
                </Field>
              </div>
              <Field orientation="horizontal">
                <Checkbox
                  id="db-conn-save-password"
                  checked={saveCredential}
                  onCheckedChange={(checked) => updateConnectionField(setSaveCredential, checked)}
                  aria-label="Save password securely"
                />
                <FieldLabel
                  htmlFor="db-conn-save-password"
                  className="cursor-pointer text-subtle-foreground"
                >
                  Save password securely
                </FieldLabel>
              </Field>
            </>
          )}
        </div>
      ) : (
        <Field>
          <FieldLabel htmlFor="db-conn-string">Connection String</FieldLabel>
          <Input
            id="db-conn-string"
            className="w-full"
            placeholder={`${dbType}://user:pass@host:port/database`}
            value={connectionString}
            onChange={(e) => updateConnectionField(setConnectionString, e.target.value)}
          />
        </Field>
      )}

      {error && (
        <Marker tone="error">
          <MarkerContent>{error}</MarkerContent>
        </Marker>
      )}

      {testResult === true && (
        <Marker tone="success">
          <MarkerContent>Connection test successful</MarkerContent>
        </Marker>
      )}
    </Dialog>
  );
}
