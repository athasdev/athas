import { AlertCircle, CheckCircle, Key, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { removeGitHubToken, storeGitHubToken } from "../utils/ai-completion";
import Button from "./ui/button";

interface GitHubCopilotSettingsProps {
  isVisible: boolean;
  onClose: () => void;
}

const GitHubCopilotSettings = ({ isVisible, onClose }: GitHubCopilotSettingsProps) => {
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
    <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div
        className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg w-full max-w-md mx-4 shadow-2xl pointer-events-auto"
        style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
          <Zap size={16} className="text-[var(--text-color)]" />
          <h2 className="font-mono text-sm font-medium text-[var(--text-color)]">
            AI Code Completion Setup
          </h2>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <div className="text-xs text-[var(--text-lighter)] leading-relaxed">
            Connect to OpenAI's API for intelligent code completions powered by GPT-3.5.
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-color)]">
              <Key size={12} />
              OpenAI API Key
            </label>

            <input
              type="password"
              value={apiKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded text-xs font-mono text-[var(--text-color)] focus:outline-none focus:border-blue-500"
              disabled={isValidating}
            />

            {/* Validation Status */}
            {validationStatus === "valid" && (
              <div className="flex items-center gap-2 text-xs text-green-500">
                <CheckCircle size={12} />
                API key validated successfully!
              </div>
            )}

            {validationStatus === "invalid" && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle size={12} />
                {errorMessage}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded p-3 space-y-2">
            <div className="text-xs font-medium text-[var(--text-color)] mb-2">
              How to get your OpenAI API key:
            </div>
            <ol className="text-xs text-[var(--text-lighter)] space-y-1 list-decimal list-inside">
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
