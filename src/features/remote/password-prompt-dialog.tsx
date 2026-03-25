import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import type { RemoteConnection } from "./types";

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

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        } else if (event.key === "Enter" && password.trim() && !isConnecting) {
          handleConnect();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, password, isConnecting]);

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
          <Button onClick={onClose} variant="ghost" size="sm">
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={!password.trim() || isConnecting} size="sm">
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="ui-text-sm text-text-lighter">
          Enter the password for <span className="font-medium text-text">{connection.name}</span> (
          {connection.username}@{connection.host}:{connection.port})
        </p>

        <div className="space-y-1.5">
          <label htmlFor="password-prompt" className="ui-text-sm font-medium text-text">
            Password
          </label>
          <div className="relative">
            <Input
              id="password-prompt"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorMessage("");
              }}
              placeholder="Enter password"
              autoFocus
              className={cn("w-full pr-10", "focus:border-accent focus:ring-accent/30")}
              disabled={isConnecting}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setShowPassword(!showPassword)}
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-3 transform",
                "text-text-lighter hover:text-text",
              )}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </div>

        {errorMessage && <p className="ui-text-sm text-red-500">{errorMessage}</p>}
      </div>
    </Dialog>
  );
};

export default PasswordPromptDialog;
