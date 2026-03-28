import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import type { DatabaseType } from "../../models/provider.types";
import { PROVIDER_REGISTRY } from "../../providers/provider-registry";
import { type SavedConnection, useConnectionStore } from "../../stores/connection-store";

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const CONNECTION_DB_TYPES: DatabaseType[] = ["sqlite", "postgres", "mysql", "mongodb", "redis"];

export function ConnectionDialog({ isOpen, onClose }: ConnectionDialogProps) {
  const { actions } = useConnectionStore();
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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const provider = PROVIDER_REGISTRY[dbType];
  const isFileBased = provider.isFileBased;

  const handleDbTypeChange = (type: DatabaseType) => {
    setDbType(type);
    setPort(PROVIDER_REGISTRY[type].defaultPort ?? 5432);
    if (PROVIDER_REGISTRY[type].isFileBased) {
      setMode("form");
    }
    setError(null);
    setTestResult(null);
  };

  const buildConfig = (): SavedConnection => ({
    id: `${dbType}-${Date.now()}`,
    name: name || `${PROVIDER_REGISTRY[dbType].label} Connection`,
    db_type: dbType,
    host,
    port,
    database,
    username,
    connection_string: mode === "string" ? connectionString : undefined,
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
    }
  };

  const handleTest = async () => {
    if (isFileBased) return;
    setIsTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const result = await actions.testConnection(buildConfig(), password || undefined);
      setTestResult(result);
      if (!result) setError("Connection test failed");
    } catch (err) {
      setError(String(err));
      setTestResult(false);
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      if (isFileBased) {
        const bufferName = name.trim() || filePath.split("/").pop() || provider.label;
        useBufferStore.getState().actions.openDatabaseBuffer(filePath, bufferName, dbType);
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
      setError(String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      title="Connect to Database"
      icon={FolderOpen}
      classNames={{
        backdrop: "bg-black/40 backdrop-blur-[2px]",
        modal: "max-w-md",
        content: "space-y-4",
      }}
      footer={
        <>
          {!isFileBased && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={isTesting || isConnecting}
              className="gap-1.5"
              aria-label="Test connection"
            >
              {isTesting ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Test
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cancel">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConnect}
            disabled={isConnecting || (isFileBased ? !filePath.trim() : false)}
            className="gap-1.5"
            aria-label={isFileBased ? "Open database" : "Connect"}
          >
            {isConnecting && <Loader2 className="animate-spin" />}
            {isFileBased ? "Open Database" : "Connect"}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <label htmlFor="db-conn-provider" className="ui-font block text-sm text-text">
          Database
        </label>
        <Select
          value={dbType}
          onChange={(value) => handleDbTypeChange(value as DatabaseType)}
          options={CONNECTION_DB_TYPES.map((type) => ({
            value: type,
            label: PROVIDER_REGISTRY[type].label,
          }))}
          className="w-full"
          menuClassName="z-[10040]"
        />
      </div>

      <div className="rounded-full bg-primary-bg/70 p-1">
        <div className="grid grid-cols-2 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMode("form")}
            className={cn(
              "rounded-full",
              mode === "form"
                ? "bg-selected text-text hover:bg-selected"
                : "text-text-lighter hover:text-text",
            )}
            data-active={mode === "form"}
            aria-label="Form mode"
          >
            Form
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => !isFileBased && setMode("string")}
            disabled={isFileBased}
            className={cn(
              "rounded-full",
              mode === "string"
                ? "bg-selected text-text hover:bg-selected"
                : "text-text-lighter hover:text-text",
              isFileBased && "hover:bg-transparent",
            )}
            data-active={mode === "string"}
            aria-label="Connection string mode"
          >
            Connection String
          </Button>
        </div>
      </div>

      {mode === "form" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="db-conn-name" className="ui-font block text-sm text-text">
              Connection Name
            </label>
            <Input
              id="db-conn-name"
              className="w-full"
              placeholder={`My ${PROVIDER_REGISTRY[dbType].label}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {isFileBased ? (
            <div className="space-y-1">
              <label htmlFor="db-conn-file" className="ui-font block text-sm text-text">
                Database File
              </label>
              <div className="flex gap-2">
                <Input
                  id="db-conn-file"
                  className="w-full"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="Select a SQLite database file"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={handleBrowseDatabaseFile}
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
                  <label htmlFor="db-conn-host" className="ui-font block text-sm text-text">
                    Host
                  </label>
                  <Input
                    id="db-conn-host"
                    className="w-full"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label htmlFor="db-conn-port" className="ui-font block text-sm text-text">
                    Port
                  </label>
                  <Input
                    id="db-conn-port"
                    type="number"
                    className="w-full"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </div>
              </div>
              {dbType !== "redis" && (
                <div className="space-y-1">
                  <label htmlFor="db-conn-database" className="ui-font block text-sm text-text">
                    Database
                  </label>
                  <Input
                    id="db-conn-database"
                    className="w-full"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                  />
                </div>
              )}
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label htmlFor="db-conn-username" className="ui-font block text-sm text-text">
                    Username
                  </label>
                  <Input
                    id="db-conn-username"
                    className="w-full"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label htmlFor="db-conn-password" className="ui-font block text-sm text-text">
                    Password
                  </label>
                  <Input
                    id="db-conn-password"
                    type="password"
                    className="w-full"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <label htmlFor="db-conn-save-password" className="flex items-center gap-2">
                <Checkbox
                  id="db-conn-save-password"
                  checked={saveCredential}
                  onChange={setSaveCredential}
                  ariaLabel="Save password securely"
                />
                <span className="ui-font text-text-lighter text-xs">Save password securely</span>
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <label htmlFor="db-conn-string" className="ui-font block text-sm text-text">
            Connection String
          </label>
          <Input
            id="db-conn-string"
            className="w-full"
            placeholder={`${dbType}://user:pass@host:port/database`}
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400 text-xs">
          {error}
        </div>
      )}

      {testResult === true && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-400 text-xs">
          Connection test successful
        </div>
      )}
    </Dialog>
  );
}
