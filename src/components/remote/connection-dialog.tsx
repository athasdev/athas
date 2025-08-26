import { AlertCircle, CheckCircle, Eye, EyeOff, Save, Server, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import Button from "../ui/button";
import Dropdown from "../ui/dropdown";
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

  // Handle ESC key to close modal
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden rounded-xl bg-black/50">
      <div className="flex max-h-[90vh] w-[480px] flex-col rounded-lg border border-border bg-primary-bg">
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-text" />
            <h3 className="font-mono text-sm text-text">
              {editingConnection ? "Edit Connection" : "New Remote Connection"}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            {editingConnection
              ? "Update your remote connection settings."
              : "Connect to remote servers via SSH or SFTP."}
          </div>

          {/* Connection Form */}
          <div className="space-y-4">
            {/* Connection Name */}
            <div className="space-y-2">
              <label htmlFor="connection-name" className="font-medium text-text text-xs">
                Connection Name *
              </label>
              <input
                id="connection-name"
                type="text"
                value={formData.name}
                onChange={(e) => updateFormData({ name: e.target.value })}
                placeholder="My Server"
                className={cn(
                  "w-full rounded border border-border bg-secondary-bg",
                  "px-3 py-2 text-text text-xs placeholder-text-lighter",
                  "focus:border-blue-500 focus:outline-none",
                )}
                disabled={isValidating}
              />
            </div>

            {/* Host, Port, Type */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6 space-y-2">
                <label htmlFor="host" className="font-medium text-text text-xs">
                  Host *
                </label>
                <input
                  id="host"
                  type="text"
                  value={formData.host}
                  onChange={(e) => updateFormData({ host: e.target.value })}
                  placeholder="192.168.1.100"
                  className={cn(
                    "w-full rounded border border-border bg-secondary-bg",
                    "px-3 py-2 text-text text-xs placeholder-text-lighter",
                    "focus:border-blue-500 focus:outline-none",
                  )}
                  disabled={isValidating}
                />
              </div>
              <div className="col-span-3 space-y-2">
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
                  className={cn(
                    "w-full rounded border border-border bg-secondary-bg",
                    "px-3 py-2 text-text text-xs placeholder-text-lighter",
                    "focus:border-blue-500 focus:outline-none",
                  )}
                  disabled={isValidating}
                />
              </div>
              <div className="col-span-3 space-y-2">
                <label htmlFor="type" className="font-medium text-text text-xs">
                  Type
                </label>
                <Dropdown
                  value={formData.type}
                  options={connectionTypeOptions}
                  onChange={(value) => updateFormData({ type: value as "ssh" | "sftp" })}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <label htmlFor="username" className="font-medium text-text text-xs">
                Username *
              </label>
              <input
                id="username"
                type="text"
                value={formData.username}
                onChange={(e) => updateFormData({ username: e.target.value })}
                placeholder="root"
                className={cn(
                  "w-full rounded border border-border bg-secondary-bg",
                  "px-3 py-2 text-text text-xs placeholder-text-lighter",
                  "focus:border-blue-500 focus:outline-none",
                )}
                disabled={isValidating}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label htmlFor="password" className="font-medium text-text text-xs">
                Password (optional)
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => updateFormData({ password: e.target.value })}
                  placeholder="Leave empty to use key authentication"
                  className={cn(
                    "w-full rounded border border-border bg-secondary-bg",
                    "px-3 py-2 pr-10 text-text text-xs placeholder-text-lighter",
                    "focus:border-blue-500 focus:outline-none",
                  )}
                  disabled={isValidating}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={cn(
                    "-translate-y-1/2 absolute top-1/2 right-3 transform",
                    "text-text-lighter transition-colors hover:text-text",
                  )}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Private Key Path */}
            <div className="space-y-2">
              <label htmlFor="keypath" className="font-medium text-text text-xs">
                Private Key Path (optional)
              </label>
              <input
                id="keypath"
                type="text"
                value={formData.keyPath}
                onChange={(e) => updateFormData({ keyPath: e.target.value })}
                placeholder="~/.ssh/id_rsa"
                className={cn(
                  "w-full rounded border border-border bg-secondary-bg",
                  "px-3 py-2 text-text text-xs placeholder-text-lighter",
                  "focus:border-blue-500 focus:outline-none",
                )}
                disabled={isValidating}
              />
            </div>

            {/* Save Credentials Option */}
            {formData.password && (
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.saveCredentials}
                    onChange={(e) => updateFormData({ saveCredentials: e.target.checked })}
                    className="rounded border border-border bg-secondary-bg text-blue-500 focus:ring-blue-500"
                    disabled={isValidating}
                  />
                  <span className="font-medium text-text text-xs">
                    Save password for future connections
                  </span>
                </label>
                <div className="text-text-lighter text-xs leading-relaxed">
                  When unchecked, you'll need to enter the password each time you connect.
                </div>
              </div>
            )}
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

        {/* Actions */}
        <div className="flex gap-2 border-border border-t p-4">
          <Button onClick={handleSave} disabled={!isFormValid || isValidating} className="flex-1">
            <Save size={14} className="mr-2" />
            {isValidating
              ? "Saving..."
              : editingConnection
                ? "Update Connection"
                : "Save Connection"}
          </Button>
          <Button onClick={onClose} variant="ghost" className="px-4">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionDialog;
