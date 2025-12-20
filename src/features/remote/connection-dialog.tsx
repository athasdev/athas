import { AlertCircle, CheckCircle, Eye, EyeOff, Server } from "lucide-react";
import { useEffect, useState } from "react";
import Button from "@/ui/button";
import Dialog from "@/ui/dialog";
import Dropdown from "@/ui/dropdown";
import { cn } from "@/utils/cn";
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
  };

  const isFormValid = formData.name.trim() && formData.host.trim() && formData.username.trim();

  const inputClassName = cn(
    "w-full rounded border border-border bg-secondary-bg",
    "px-3 py-2 text-text text-xs placeholder-text-lighter",
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
        <p className="text-text-lighter text-xs">
          {editingConnection
            ? "Update your remote connection settings."
            : "Connect to remote servers via SSH or SFTP."}
        </p>

        {/* Connection Name */}
        <div className="space-y-1.5">
          <label htmlFor="connection-name" className="font-medium text-text text-xs">
            Connection Name <span className="text-text-lighter">*</span>
          </label>
          <input
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
            <label htmlFor="host" className="font-medium text-text text-xs">
              Host <span className="text-text-lighter">*</span>
            </label>
            <input
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
            <label htmlFor="port" className="font-medium text-text text-xs">
              Port
            </label>
            <input
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
          <label htmlFor="type" className="font-medium text-text text-xs">
            Connection Type
          </label>
          <Dropdown
            value={formData.type}
            options={connectionTypeOptions}
            onChange={(value) => updateFormData({ type: value as "ssh" | "sftp" })}
            className="text-xs"
          />
        </div>

        {/* Username */}
        <div className="space-y-1.5">
          <label htmlFor="username" className="font-medium text-text text-xs">
            Username <span className="text-text-lighter">*</span>
          </label>
          <input
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
          <label htmlFor="password" className="font-medium text-text text-xs">
            Password <span className="text-text-lighter">(optional)</span>
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(e) => updateFormData({ password: e.target.value })}
              placeholder="Leave empty to use key authentication"
              className={cn(inputClassName, "pr-10")}
              disabled={isValidating}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-3 transform",
                "text-text-lighter transition-colors hover:text-text",
              )}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Save Credentials Option */}
        {formData.password && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={formData.saveCredentials}
              onChange={(e) => updateFormData({ saveCredentials: e.target.checked })}
              className="rounded border-border bg-secondary-bg text-accent focus:ring-accent"
              disabled={isValidating}
            />
            <span className="text-text text-xs">Save password for future connections</span>
          </label>
        )}

        {/* Private Key Path */}
        <div className="space-y-1.5">
          <label htmlFor="keypath" className="font-medium text-text text-xs">
            Private Key Path <span className="text-text-lighter">(optional)</span>
          </label>
          <input
            id="keypath"
            type="text"
            value={formData.keyPath}
            onChange={(e) => updateFormData({ keyPath: e.target.value })}
            placeholder="~/.ssh/id_rsa"
            className={inputClassName}
            disabled={isValidating}
          />
        </div>

        {/* Validation Status */}
        {validationStatus === "valid" && (
          <div className="flex items-center gap-2 text-green-500 text-xs">
            <CheckCircle size={12} />
            Connection saved successfully!
          </div>
        )}

        {validationStatus === "invalid" && (
          <div className="flex items-center gap-2 text-red-500 text-xs">
            <AlertCircle size={12} />
            {errorMessage}
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default ConnectionDialog;
