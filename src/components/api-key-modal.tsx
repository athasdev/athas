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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[90vh] w-[480px] flex-col rounded-lg border border-border bg-primary-bg">
        {/* Header */}
        <div className="flex items-center justify-between border-border border-b p-4">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-text" />
            <h3 className="font-mono text-sm text-text">{provider.name} API Key</h3>
          </div>
          <button onClick={onClose} className="text-text-lighter transition-colors hover:text-text">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="text-text-lighter text-xs leading-relaxed">
            Connect to {provider.name} to access their AI models for intelligent code assistance.
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <label
              htmlFor="api-key-input"
              className="flex items-center gap-2 font-medium text-text text-xs"
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
              className="w-full rounded border border-border bg-secondary-bg px-3 py-2 font-mono text-text text-xs focus:border-blue-500 focus:outline-none"
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
            <div className="mb-2 font-medium text-text text-xs">{instructions.title}</div>
            <ol className="list-inside list-decimal space-y-1 text-text-lighter text-xs">
              {instructions.steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            {instructions.link && (
              <div className="mt-2 border-border border-t pt-2">
                <a
                  href={instructions.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 text-xs transition-colors hover:text-blue-300"
                >
                  <ExternalLink size={10} />
                  Open {provider.name} Dashboard
                </a>
              </div>
            )}
          </div>

          {/* Model Info */}
          <div className="rounded border border-border bg-secondary-bg p-3">
            <div className="mb-2 font-medium text-text text-xs">Available Models:</div>
            <div className="space-y-1">
              {provider.models.slice(0, 3).map(model => (
                <div key={model.id} className="flex items-center justify-between text-xs">
                  <span className="text-text">{model.name}</span>
                  <span className="text-text-lighter">
                    {model.costPer1kTokens && `$${model.costPer1kTokens}/1k tokens`}
                  </span>
                </div>
              ))}
              {provider.models.length > 3 && (
                <div className="text-text-lighter text-xs">
                  +{provider.models.length - 3} more models
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-border border-t p-4">
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
