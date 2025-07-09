import { AlertCircle, CheckCircle, Eye, EyeOff, Save, Server, X } from "lucide-react";
import { useEffect, useState } from "react";
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
    } catch (_error) {
      setValidationStatus("invalid");
      setErrorMessage("An error occurred while saving the connection.");
    } finally {
      setIsValidating(false);
    }
  };

  const updateFormData = (updates: Partial<RemoteConnectionFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
    setValidationStatus("idle");
    setErrorMessage("");
  };

  const isFormValid = formData.name.trim() && formData.host.trim() && formData.username.trim();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 rounded-xl overflow-hidden">
      <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg w-[480px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--text-color)]" />
            <h3 className="font-mono text-sm text-[var(--text-color)]">
              {editingConnection ? "Edit Connection" : "New Remote Connection"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div className="text-xs text-[var(--text-lighter)] leading-relaxed">
            {editingConnection
              ? "Update your remote connection settings."
              : "Connect to remote servers via SSH or SFTP."}
          </div>

          {/* Connection Form */}
          <div className="space-y-4">
            {/* Connection Name */}
            <div className="space-y-2">
              <label
                htmlFor="connection-name"
                className="text-xs font-medium text-[var(--text-color)]"
              >
                Connection Name *
              </label>
              <input
                id="connection-name"
                type="text"
                value={formData.name}
                onChange={e => updateFormData({ name: e.target.value })}
                placeholder="My Server"
                className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                disabled={isValidating}
              />
            </div>

            {/* Host, Port, Type */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-6 space-y-2">
                <label htmlFor="host" className="text-xs font-medium text-[var(--text-color)]">
                  Host *
                </label>
                <input
                  id="host"
                  type="text"
                  value={formData.host}
                  onChange={e => updateFormData({ host: e.target.value })}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                  disabled={isValidating}
                />
              </div>
              <div className="col-span-3 space-y-2">
                <label htmlFor="port" className="text-xs font-medium text-[var(--text-color)]">
                  Port
                </label>
                <input
                  id="port"
                  type="number"
                  value={formData.port}
                  onChange={e => updateFormData({ port: parseInt(e.target.value) || 22 })}
                  placeholder="22"
                  min="1"
                  max="65535"
                  className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                  disabled={isValidating}
                />
              </div>
              <div className="col-span-3 space-y-2">
                <label htmlFor="type" className="text-xs font-medium text-[var(--text-color)]">
                  Type
                </label>
                <Dropdown
                  value={formData.type}
                  options={connectionTypeOptions}
                  onChange={value => updateFormData({ type: value as "ssh" | "sftp" })}
                  className="text-xs"
                />
              </div>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <label htmlFor="username" className="text-xs font-medium text-[var(--text-color)]">
                Username *
              </label>
              <input
                id="username"
                type="text"
                value={formData.username}
                onChange={e => updateFormData({ username: e.target.value })}
                placeholder="root"
                className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                disabled={isValidating}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label htmlFor="password" className="text-xs font-medium text-[var(--text-color)]">
                Password (optional)
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={e => updateFormData({ password: e.target.value })}
                  placeholder="Leave empty to use key authentication"
                  className="w-full px-3 py-2 pr-10 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                  disabled={isValidating}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Private Key Path */}
            <div className="space-y-2">
              <label htmlFor="keypath" className="text-xs font-medium text-[var(--text-color)]">
                Private Key Path (optional)
              </label>
              <input
                id="keypath"
                type="text"
                value={formData.keyPath}
                onChange={e => updateFormData({ keyPath: e.target.value })}
                placeholder="~/.ssh/id_rsa"
                className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs text-[var(--text-color)] focus:outline-none focus:border-blue-500 placeholder-[var(--text-lighter)]"
                disabled={isValidating}
              />
            </div>
          </div>

          {/* Validation Status */}
          {validationStatus === "valid" && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <CheckCircle size={12} />
              Connection saved successfully!
            </div>
          )}

          {validationStatus === "invalid" && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertCircle size={12} />
              {errorMessage}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4 border-t border-[var(--border-color)]">
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
