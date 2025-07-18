import { AlertCircle, CheckCircle, Key, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { useUIState } from "../stores/ui-state-store";
import { removeGitHubToken, storeGitHubToken } from "../utils/ai-completion";
import Button from "./ui/button";

const GitHubCopilotSettings = () => {
  // Get data from stores
  const { isGitHubCopilotSettingsVisible, setIsGitHubCopilotSettingsVisible } = useUIState();

  const isVisible = isGitHubCopilotSettingsVisible;
  const onClose = () => setIsGitHubCopilotSettingsVisible(false);
  const [apiKey, setApiKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);

  // Load existing key on mount
  useEffect(() => {
    if (isVisible) {
      loadExistingKey();
    }
  }, [isVisible]);

  const loadExistingKey = async () => {
    try {
      // Check if key exists without exposing it
      const { invoke } = await import("@tauri-apps/api/core");
      const key = (await invoke("get_github_token")) as string | null;
      if (key) {
        setHasExistingKey(true);
        setApiKey("••••••••••••••••••••"); // Mask existing key
      } else {
        setHasExistingKey(false);
        setApiKey("");
      }
    } catch (error) {
      console.error("Error loading API key:", error);
      setHasExistingKey(false);
    }
  };

  const validateOpenAIKey = async (key: string): Promise<boolean> => {
    try {
      // Test the key by making a simple API call
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (response.ok) {
        console.log("OpenAI API key validated successfully");
        return true;
      } else {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
    } catch (_error) {
      console.error("API key validation error:", _error);
      return false;
    }
  };

  const handleSaveKey = async () => {
    // If using existing key, just close
    if (hasExistingKey && apiKey.startsWith("•")) {
      onClose();
      return;
    }

    if (!apiKey.trim()) {
      setErrorMessage("Please enter an OpenAI API key");
      return;
    }

    setIsValidating(true);
    setValidationStatus("idle");
    setErrorMessage("");

    try {
      const isValid = await validateOpenAIKey(apiKey);

      if (isValid) {
        await storeGitHubToken(apiKey);
        setValidationStatus("valid");
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setValidationStatus("invalid");
        setErrorMessage("Invalid GitHub token. Please check your token and try again.");
      }
    } catch (_error) {
      setValidationStatus("invalid");
      setErrorMessage("Failed to validate token. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async () => {
    try {
      await removeGitHubToken();
      setHasExistingKey(false);
      setApiKey("");
      setValidationStatus("idle");
      setErrorMessage("");
    } catch (_error) {
      setErrorMessage("Failed to remove token");
    }
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setValidationStatus("idle");
    setErrorMessage("");
    setHasExistingKey(false); // User is entering new token
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="pointer-events-auto mx-4 w-full max-w-md rounded-lg border border-border bg-primary-bg shadow-2xl"
        style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-border border-b px-4 py-3">
          <Zap size={16} className="text-text" />
          <h2 className="font-medium font-mono text-sm text-text">AI Code Completion Setup</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            Connect to OpenAI's API for intelligent code completions powered by GPT-3.5.
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label
              htmlFor="openai-api-key"
              className="flex items-center gap-2 font-medium text-text text-xs"
            >
              <Key size={12} />
              OpenAI API Key
            </label>

            <input
              id="openai-api-key"
              type="password"
              value={apiKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
              className={cn(
                "w-full rounded border border-border bg-secondary-bg",
                "px-3 py-2 font-mono text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
              )}
              disabled={isValidating}
            />

            {/* Validation Status */}
            {validationStatus === "valid" && (
              <div className="flex items-center gap-2 text-green-500 text-xs">
                <CheckCircle size={12} />
                API key validated successfully!
              </div>
            )}

            {validationStatus === "invalid" && (
              <div className="flex items-center gap-2 text-red-500 text-xs">
                <AlertCircle size={12} />
                {errorMessage}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-2 rounded border border-border bg-secondary-bg p-3">
            <div className="mb-2 font-medium text-text text-xs">
              How to get your OpenAI API key:
            </div>
            <ol className="list-inside list-decimal space-y-1 text-text-lighter text-xs">
              <li>
                Go to{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  className="text-blue-400 hover:text-blue-300"
                >
                  OpenAI API Keys
                </a>
              </li>
              <li>Click "Create new secret key"</li>
              <li>Copy the generated key and paste it above</li>
              <li>Note: You'll need credits in your OpenAI account</li>
            </ol>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || isValidating}
              className="flex-1"
            >
              {isValidating
                ? "Validating..."
                : hasExistingKey && apiKey.startsWith("•")
                  ? "Use Existing"
                  : "Save & Connect"}
            </Button>
            {hasExistingKey && (
              <Button
                onClick={handleRemoveKey}
                variant="ghost"
                className="px-4 text-red-500 hover:bg-red-500/10"
              >
                Remove
              </Button>
            )}
            <Button onClick={onClose} variant="ghost" className="px-4">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitHubCopilotSettings;
