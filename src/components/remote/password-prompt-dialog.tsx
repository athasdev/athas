import { Eye, EyeOff, Lock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import Button from "../ui/button";
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
      // Display a user-friendly error message
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden rounded-xl bg-black/50">
      <div className="flex w-[400px] flex-col rounded-lg border border-border bg-primary-bg">
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-text" />
            <h3 className="font-mono text-sm text-text">Enter Password</h3>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            Enter the password for <span className="font-medium text-text">{connection.name}</span>{" "}
            ({connection.username}@{connection.host}:{connection.port})
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <label htmlFor="password-prompt" className="font-medium text-text text-xs">
              Password
            </label>
            <div className="relative">
              <input
                id="password-prompt"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrorMessage("");
                }}
                placeholder="Enter password"
                className={cn(
                  "w-full rounded border border-border bg-secondary-bg",
                  "px-3 py-2 pr-10 text-text text-xs placeholder-text-lighter",
                  "focus:border-blue-500 focus:outline-none",
                )}
                disabled={isConnecting}
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

          {errorMessage && <div className="text-red-500 text-xs">{errorMessage}</div>}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-border border-t p-4">
          <Button
            onClick={handleConnect}
            disabled={!password.trim() || isConnecting}
            className="flex-1"
          >
            {isConnecting ? "Connecting..." : "Connect"}
          </Button>
          <Button onClick={onClose} variant="ghost" className="px-4">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PasswordPromptDialog;
