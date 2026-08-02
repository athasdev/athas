import { EyeIcon as Eye, EyeSlashIcon as EyeOff } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import type { RemoteConnection } from "../types/remote.types";

interface PasswordPromptDialogProps {
  isOpen: boolean;
  connection: RemoteConnection | null;
  onClose: () => void;
  onConnect: (connectionId: string, password: string) => Promise<void>;
}

const PasswordPromptDialog = ({
  isOpen,
  connection,
  onClose,
  onConnect,
}: PasswordPromptDialogProps) => {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      setPassword("");
      setShowPassword(false);
      setIsConnecting(false);
      setErrorMessage("");
    }
  }, [isOpen]);

  if (!isOpen || !connection) return null;

  const handleConnect = async () => {
    if (!password.trim()) {
      setErrorMessage("Password is required");
      return;
    }

    setIsConnecting(true);
    setErrorMessage("");

    try {
      await onConnect(connection.id, password);
      onClose();
    } catch (error) {
      const rawError = error instanceof Error ? error.message : String(error);
      let friendlyError = rawError;

      if (rawError.includes("Authentication failed") || rawError.includes("username/password")) {
        friendlyError = "Incorrect username or password. Please try again.";
      } else if (rawError.includes("Connection refused") || rawError.includes("unreachable")) {
        friendlyError = "Cannot connect to server. Check the host address and port.";
      } else if (rawError.includes("timeout")) {
        friendlyError = "Connection timed out. The server may be unavailable.";
      } else if (rawError.includes("Host key verification failed")) {
        friendlyError =
          "Host key verification failed. The server's identity could not be verified.";
      } else if (rawError.includes("Permission denied")) {
        friendlyError = "Permission denied. Check your username and password.";
      } else if (rawError.includes("No route to host")) {
        friendlyError = "Cannot reach the server. Check your network connection.";
      }

      setErrorMessage(friendlyError || "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <Dialog
      onClose={onClose}
      title="Enter Password"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} variant="ghost" size="xs">
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={!password.trim() || isConnecting} size="xs">
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="ui-text-sm text-subtle-foreground">
          Enter the password for{" "}
          <span className="font-medium text-foreground">{connection.name}</span> (
          {connection.username}@{connection.host}:{connection.port})
        </p>

        <Field data-invalid={Boolean(errorMessage)}>
          <FieldLabel htmlFor="password-prompt">Password</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="password-prompt"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && password.trim() && !isConnecting) {
                  event.preventDefault();
                  void handleConnect();
                }
              }}
              placeholder="Enter password"
              autoFocus
              disabled={isConnecting}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                variant="ghost"
                onClick={() => setShowPassword(!showPassword)}
                tooltip={showPassword ? "Hide password" : "Show password"}
                size="icon-sm"
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldError>{errorMessage}</FieldError>
        </Field>
      </div>
    </Dialog>
  );
};

export default PasswordPromptDialog;
