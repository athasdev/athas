import { HardDrivesIcon as Server } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { LoadingIndicator } from "@/ui/loading";
import { testRemoteConnection } from "../services/remote-connection-actions";
import type { RemoteConnection, RemoteConnectionFormData } from "../types/remote.types";
import ConnectionForm from "./connection-form";

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
          <Button onClick={onClose} variant="ghost" compact>
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
            compact
            disabled={isTesting}
          >
            {isTesting ? <LoadingIndicator label="Testing" showLabel compact /> : "Test Connection"}
          </Button>
          <Button onClick={handleSave} disabled={!isFormValid || isValidating} compact>
            {isValidating
              ? "Saving..."
              : editingConnection
                ? "Update Connection"
                : "Save Connection"}
          </Button>
        </>
      }
    >
      <ConnectionForm
        formData={formData}
        onChange={updateFormData}
        showPassword={showPassword}
        onShowPasswordChange={setShowPassword}
        validationStatus={validationStatus}
        errorMessage={errorMessage}
        testStatus={testStatus}
        testMessage={testMessage}
        disabled={isValidating}
        intro={
          editingConnection
            ? "Update your remote connection settings."
            : "Connect to remote servers via SSH or SFTP."
        }
        idPrefix="remote-connection"
        onSubmit={() => void handleSave()}
      />
    </Dialog>
  );
};

export default ConnectionDialog;
