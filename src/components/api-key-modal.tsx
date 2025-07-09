import { AlertCircle, CheckCircle, ExternalLink, Key, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getProviderById } from "../types/ai-provider";
import Button from "./ui/button";

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  onSave: (providerId: string, apiKey: string) => Promise<boolean>;
  onRemove: (providerId: string) => Promise<void>;
  hasExistingKey: boolean;
}

const ApiKeyModal = ({
  isOpen,
  onClose,
  providerId,
  onSave,
  onRemove,
  hasExistingKey,
}: ApiKeyModalProps) => {
  const [apiKey, setApiKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const provider = getProviderById(providerId);

  useEffect(() => {
    if (isOpen) {
      if (hasExistingKey) {
        setApiKey("••••••••••••••••••••"); // Mask existing key
      } else {
        setApiKey("");
      }
      setValidationStatus("idle");
      setErrorMessage("");
    }
  }, [isOpen, hasExistingKey]);

  if (!isOpen || !provider) return null;

  const getApiKeyPlaceholder = () => {
    switch (providerId) {
      case "athas":
        return "No API key needed - subscription based";
      case "openrouter":
        return "sk-or-v1-xxxxxxxxxxxxxxxxxxxx";
      default:
        return "Enter your API key...";
    }
  };

  const getInstructions = () => {
    switch (providerId) {
      case "athas":
        return {
          title: "Athas AI Subscription:",
          steps: [
            "Choose a subscription plan that fits your needs",
            "Get unlimited access to premium AI models",
            "No API key management required",
            "Focus on coding, we handle the rest",
          ],
          link: "https://athas.dev/pricing",
        };
      case "openrouter":
        return {
          title: "How to get your OpenRouter API key:",
          steps: [
            "Go to OpenRouter Keys page",
            'Click "Create Key"',
            "Give your key a name (optional)",
            "Copy the generated key and paste it above",
            "Note: OpenRouter provides access to many models",
          ],
          link: "https://openrouter.ai/keys",
        };
      default:
        return {
          title: "API Key Required:",
          steps: [
            "Visit the provider's website",
            "Create an account if needed",
            "Generate an API key",
            "Paste the key above",
          ],
          link: "",
        };
    }
  };

  const handleSaveKey = async () => {
    // If using existing key, just close
    if (hasExistingKey && apiKey.startsWith("•")) {
      onClose();
      return;
    }

    if (!apiKey.trim()) {
      setErrorMessage("Please enter an API key");
      return;
    }

    setIsValidating(true);
    setValidationStatus("idle");
    setErrorMessage("");

    try {
      const isValid = await onSave(providerId, apiKey);

      if (isValid) {
        setValidationStatus("valid");
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setValidationStatus("invalid");
        setErrorMessage("Invalid API key. Please check your key and try again.");
      }
    } catch (_error) {
      setValidationStatus("invalid");
      setErrorMessage("Failed to validate API key. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async () => {
    try {
      await onRemove(providerId);
      setApiKey("");
      setValidationStatus("idle");
      setErrorMessage("");
    } catch (_error) {
      setErrorMessage("Failed to remove API key");
    }
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setValidationStatus("idle");
    setErrorMessage("");
  };

  const instructions = getInstructions();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--primary-bg)] border border-[var(--border-color)] rounded-lg w-[480px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-[var(--text-color)]" />
            <h3 className="font-mono text-sm text-[var(--text-color)]">{provider.name} API Key</h3>
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
            Connect to {provider.name} to access their AI models for intelligent code assistance.
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label
              htmlFor="api-key-input"
              className="flex items-center gap-2 text-xs font-medium text-[var(--text-color)]"
            >
              <Key size={12} />
              API Key
            </label>

            <input
              id="api-key-input"
              type="password"
              value={apiKey}
              onChange={e => handleKeyChange(e.target.value)}
              placeholder={getApiKeyPlaceholder()}
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
              {instructions.title}
            </div>
            <ol className="text-xs text-[var(--text-lighter)] space-y-1 list-decimal list-inside">
              {instructions.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            {instructions.link && (
              <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                <a
                  href={instructions.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink size={10} />
                  Open {provider.name} Dashboard
                </a>
              </div>
            )}
          </div>

          {/* Model Info */}
          <div className="bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded p-3">
            <div className="text-xs font-medium text-[var(--text-color)] mb-2">
              Available Models:
            </div>
            <div className="space-y-1">
              {provider.models.slice(0, 3).map(model => (
                <div key={model.id} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-color)]">{model.name}</span>
                  <span className="text-[var(--text-lighter)]">
                    {model.costPer1kTokens && `$${model.costPer1kTokens}/1k tokens`}
                  </span>
                </div>
              ))}
              {provider.models.length > 3 && (
                <div className="text-xs text-[var(--text-lighter)]">
                  +{provider.models.length - 3} more models
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4 border-t border-[var(--border-color)]">
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
  );
};

export default ApiKeyModal;
