import { EyeIcon, EyeSlashIcon } from "@/ui/icons";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { getFriendlyRemoteError } from "../services/remote-errors";
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

  const connectionAddress = `${connection.username ? `${connection.username}@` : ""}${connection.host}:${connection.port}`;

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
      setErrorMessage(getFriendlyRemoteError(error));
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
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={!password.trim() || isConnecting}>
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="ui-text-sm text-subtle-foreground">
          Enter the password for{" "}
          <span className="font-medium text-foreground">{connection.name}</span> (
          {connectionAddress})
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
                iconOnly
              >
                {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
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
