import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import Select from "@/ui/select";
import { cn } from "@/utils/cn";
import { testRemoteConnection } from "./services/remote-connection-actions";
import type { RemoteConnection, RemoteConnectionFormData } from "./types";

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (connection: RemoteConnectionFormData) => Promise<boolean>;
  editingConnection?: RemoteConnection | null;
}

const ConnectionDialog = ({
  isOpen,
  onClose,
  onSave,
  editingConnection = null,
}: ConnectionDialogProps) => {
  const [formData, setFormData] = useState<RemoteConnectionFormData>({
    name: "",
    host: "",
    port: 22,
    username: "",
    password: "",
    keyPath: "",
    type: "ssh",
    saveCredentials: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const connectionTypeOptions = [
    { value: "ssh", label: "SSH" },
    { value: "sftp", label: "SFTP" },
  ];

  useEffect(() => {
    if (isOpen) {
      if (editingConnection) {
        setFormData({
          name: editingConnection.name,
          host: editingConnection.host,
          port: editingConnection.port,
          username: editingConnection.username,
          password: editingConnection.password || "",
          keyPath: editingConnection.keyPath || "",
          type: editingConnection.type,
          saveCredentials: editingConnection.saveCredentials ?? false,
        });
      } else {
        setFormData({
          name: "",
          host: "",
          port: 22,
          username: "",
          password: "",
          keyPath: "",
          type: "ssh",
          saveCredentials: false,
        });
      }
      setValidationStatus("idle");
      setErrorMessage("");
      setShowPassword(false);
    }
  }, [isOpen, editingConnection]);

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.host.trim() || !formData.username.trim()) {
      setErrorMessage("Please fill in all required fields");
      setValidationStatus("invalid");
      return;
    }

    setIsValidating(true);
    setValidationStatus("idle");
    setErrorMessage("");

    try {
      const success = await onSave(formData);

      if (success) {
        setValidationStatus("valid");
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setValidationStatus("invalid");
        setErrorMessage("Failed to save connection. Please try again.");
      }
    } catch {
      setValidationStatus("invalid");
      setErrorMessage("An error occurred while saving the connection.");
    } finally {
      setIsValidating(false);
    }
  };

  const updateFormData = (updates: Partial<RemoteConnectionFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
    setValidationStatus("idle");
    setErrorMessage("");
    setTestStatus("idle");
    setTestMessage("");
  };

  const isFormValid = formData.name.trim() && formData.host.trim() && formData.username.trim();

  const inputClassName = cn(
    "w-full rounded border border-border bg-secondary-bg",
    "ui-text-sm px-3 py-2 text-text placeholder-text-lighter",
    "focus:border-accent focus:outline-none",
  );

  return (
    <Dialog
      onClose={onClose}
      title={editingConnection ? "Edit Connection" : "New Remote Connection"}
      icon={Server}
      classNames={{
        modal: "max-w-[420px]",
      }}
      footer={
        <>
          <Button onClick={onClose} variant="ghost" size="sm">
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!formData.host.trim() || !formData.username.trim()) {
                setTestStatus("error");
                setTestMessage("Host and username are required to test.");
                return;
              }
              setIsTesting(true);
              setTestStatus("idle");
              setTestMessage("");
              try {
                await testRemoteConnection(formData);
                setTestStatus("success");
                setTestMessage("Connection successful.");
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setTestStatus("error");
                setTestMessage(msg || "Connection failed.");
              } finally {
                setIsTesting(false);
              }
            }}
            variant="ghost"
            size="sm"
            disabled={isTesting}
          >
            {isTesting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="animate-spin" /> Testing
              </span>
            ) : (
              "Test Connection"
            )}
          </Button>
          <Button onClick={handleSave} disabled={!isFormValid || isValidating} size="sm">
            {isValidating
              ? "Saving..."
              : editingConnection
                ? "Update Connection"
                : "Save Connection"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="ui-text-sm text-text-lighter">
          {editingConnection
            ? "Update your remote connection settings."
            : "Connect to remote servers via SSH or SFTP."}
        </p>

        {/* Connection Name */}
        <div className="space-y-1.5">
          <label htmlFor="connection-name" className="ui-text-sm font-medium text-text">
            Connection Name <span className="text-text-lighter">*</span>
          </label>
          <Input
            id="connection-name"
            type="text"
            value={formData.name}
            onChange={(e) => updateFormData({ name: e.target.value })}
            placeholder="My Server"
            className={inputClassName}
            disabled={isValidating}
          />
        </div>

        {/* Host and Port */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-8 space-y-1.5">
            <label htmlFor="host" className="ui-text-sm font-medium text-text">
              Host <span className="text-text-lighter">*</span>
            </label>
            <Input
              id="host"
              type="text"
              value={formData.host}
              onChange={(e) => updateFormData({ host: e.target.value })}
              placeholder="192.168.1.100"
              className={inputClassName}
              disabled={isValidating}
            />
          </div>
          <div className="col-span-4 space-y-1.5">
            <label htmlFor="port" className="ui-text-sm font-medium text-text">
              Port
            </label>
            <Input
              id="port"
              type="number"
              value={formData.port}
              onChange={(e) => updateFormData({ port: parseInt(e.target.value) || 22 })}
              placeholder="22"
              min="1"
              max="65535"
              className={inputClassName}
              disabled={isValidating}
            />
          </div>
        </div>

        {/* Type */}
        <div className="space-y-1.5">
          <label htmlFor="type" className="ui-text-sm font-medium text-text">
            Connection Type
          </label>
          <Select
            value={formData.type}
            options={connectionTypeOptions}
            onChange={(value) => updateFormData({ type: value as "ssh" | "sftp" })}
            className="ui-text-sm"
          />
        </div>

        {/* Username */}
        <div className="space-y-1.5">
          <label htmlFor="username" className="ui-text-sm font-medium text-text">
            Username <span className="text-text-lighter">*</span>
          </label>
          <Input
            id="username"
            type="text"
            value={formData.username}
            onChange={(e) => updateFormData({ username: e.target.value })}
            placeholder="root"
            className={inputClassName}
            disabled={isValidating}
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="ui-text-sm font-medium text-text">
            Password <span className="text-text-lighter">(optional)</span>
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => updateFormData({ password: e.target.value })}
              placeholder="Leave empty to use key authentication"
              className={`${inputClassName} pr-10`}
              disabled={isValidating}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowPassword(!showPassword)}
              className="-translate-y-1/2 absolute top-1/2 right-3 transform text-text-lighter hover:text-text"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </div>

        {/* Save Credentials Option */}
        {formData.password && (
          <label htmlFor="save-credentials" className="flex cursor-pointer items-center gap-2">
            <Checkbox
              id="save-credentials"
              checked={!!formData.saveCredentials}
              onChange={(checked) => updateFormData({ saveCredentials: !!checked })}
              disabled={isValidating}
            />
            <span className="ui-text-sm text-text">Save password for future connections</span>
          </label>
        )}

        {/* Private Key Path */}
        <div className="space-y-1.5">
          <label htmlFor="keypath" className="ui-text-sm font-medium text-text">
            Private Key Path <span className="text-text-lighter">(optional)</span>
          </label>
          <Input
            id="keypath"
            type="text"
            value={formData.keyPath}
            onChange={(e) => updateFormData({ keyPath: e.target.value })}
            placeholder="~/.ssh/id_rsa"
            className={inputClassName}
            disabled={isValidating}
          />
        </div>

        {/* Validation/Test Status */}
        {testStatus !== "idle" && (
          <div
            className={`ui-text-sm flex items-center gap-2 ${testStatus === "success" ? "text-green-500" : "text-red-500"}`}
          >
            {testStatus === "success" ? <CheckCircle /> : <AlertCircle />}
            {testMessage}
          </div>
        )}
        {validationStatus === "valid" && (
          <div className="ui-text-sm flex items-center gap-2 text-green-500">
            <CheckCircle />
            Connection saved successfully!
          </div>
        )}

        {validationStatus === "invalid" && (
          <div className="ui-text-sm flex items-center gap-2 text-red-500">
            <AlertCircle />
            {errorMessage}
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default ConnectionDialog;
