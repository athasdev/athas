import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, Check, CheckCircle, Eye, EyeOff, Key, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAIChatStore } from "@/features/ai/store/store";
import type { ClaudeStatus } from "@/features/ai/types/claude";
import { getAvailableProviders, setClaudeCodeAvailability } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Section, { SettingRow } from "@/ui/section";
import Switch from "@/ui/switch";
import { cn } from "@/utils/cn";

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();

  // Check Claude Code availability on mount
  useEffect(() => {
    const checkClaudeCodeStatus = async () => {
      try {
        const status = await invoke<ClaudeStatus>("get_claude_status");
        setClaudeCodeAvailability(status.interceptor_running);
      } catch {
        setClaudeCodeAvailability(false);
      }
    };
    checkClaudeCodeStatus();
  }, []);

  // State for inline API key editing
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    providerId: string | null;
    status: "valid" | "invalid" | null;
    message?: string;
  }>({ providerId: null, status: null });

  // API Key functions from AI chat store
  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);
  const checkAllProviderApiKeys = useAIChatStore((state) => state.checkAllProviderApiKeys);

  // Check all provider API keys on mount
  useEffect(() => {
    checkAllProviderApiKeys();
  }, [checkAllProviderApiKeys]);

  const currentProvider = getAvailableProviders().find((p) => p.id === settings.aiProviderId);

  const providerOptions = getAvailableProviders().map((provider) => ({
    value: provider.id,
    label: provider.name,
  }));

  const modelOptions =
    currentProvider?.models.map((model) => ({
      value: model.id,
      label: model.name,
    })) || [];

  const handleProviderChange = (providerId: string) => {
    const provider = getAvailableProviders().find((p) => p.id === providerId);
    if (provider && provider.models.length > 0) {
      updateSetting("aiProviderId", providerId);
      updateSetting("aiModelId", provider.models[0].id);
    }
  };

  const handleModelChange = (modelId: string) => {
    updateSetting("aiModelId", modelId);
  };

  const startEditing = (providerId: string) => {
    setEditingProvider(providerId);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
  };

  const cancelEditing = () => {
    setEditingProvider(null);
    setApiKeyInput("");
    setShowKey(false);
    setValidationStatus({ providerId: null, status: null });
  };

  const handleSaveKey = async (providerId: string) => {
    if (!apiKeyInput.trim()) {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Please enter an API key",
      });
      return;
    }

    setIsValidating(true);
    setValidationStatus({ providerId: null, status: null });

    try {
      const isValid = await saveApiKey(providerId, apiKeyInput);

      if (isValid) {
        setValidationStatus({
          providerId,
          status: "valid",
          message: "API key saved successfully",
        });
        setTimeout(() => {
          cancelEditing();
        }, 1500);
      } else {
        setValidationStatus({
          providerId,
          status: "invalid",
          message: "Invalid API key. Please check and try again.",
        });
      }
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to validate API key",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemoveKey = async (providerId: string) => {
    try {
      await removeApiKey(providerId);
      setValidationStatus({
        providerId,
        status: "valid",
        message: "API key removed",
      });
      setTimeout(() => {
        setValidationStatus({ providerId: null, status: null });
      }, 2000);
    } catch {
      setValidationStatus({
        providerId,
        status: "invalid",
        message: "Failed to remove API key",
      });
    }
  };

  const renderApiKeyInput = (providerId: string, providerName: string) => {
    const isEditing = editingProvider === providerId;
    const hasKey = hasProviderApiKey(providerId);
    const showingValidation = validationStatus.providerId === providerId && validationStatus.status;

    if (!isEditing && !hasKey && !showingValidation) {
      return (
        <Button
          variant="outline"
          size="xs"
          onClick={() => startEditing(providerId)}
          className="gap-1.5"
        >
          <Key size={12} />
          Set API Key
        </Button>
      );
    }

    if (!isEditing && hasKey) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-green-500 text-xs">
            <Check size={12} />
            <span>Configured</span>
          </div>
          <Button variant="ghost" size="xs" onClick={() => startEditing(providerId)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => handleRemoveKey(providerId)}
            className="text-red-500 hover:bg-red-500/10"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`Enter ${providerName} API key...`}
              className={cn(
                "ui-font w-full rounded border bg-secondary-bg px-2 py-1.5 pr-8 text-text text-xs",
                "focus:border-blue-500 focus:outline-none",
                showingValidation && validationStatus.status === "invalid"
                  ? "border-red-500"
                  : "border-border",
              )}
              disabled={isValidating}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-text-lighter transition-colors hover:text-text"
            >
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <Button
            variant="default"
            size="xs"
            onClick={() => handleSaveKey(providerId)}
            disabled={!apiKeyInput.trim() || isValidating}
          >
            {isValidating ? "Saving..." : "Save"}
          </Button>
          <Button variant="ghost" size="xs" onClick={cancelEditing}>
            <X size={12} />
          </Button>
        </div>

        {showingValidation && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              validationStatus.status === "valid" ? "text-green-500" : "text-red-500",
            )}
          >
            {validationStatus.status === "valid" ? (
              <CheckCircle size={12} />
            ) : (
              <AlertCircle size={12} />
            )}
            <span>{validationStatus.message}</span>
          </div>
        )}
      </div>
    );
  };

  // Get all providers that require API keys
  const providersNeedingKeys = getAvailableProviders().filter((p) => p.requiresApiKey);

  // Get all providers that require authentication (but not API keys)
  const providersNeedingAuth = getAvailableProviders().filter(
    (p) => p.requiresAuth && !p.requiresApiKey,
  );

  return (
    <div className="space-y-4">
      <Section title="Provider & Model">
        <SettingRow label="Provider" description="Choose your AI service provider">
          <Dropdown
            value={settings.aiProviderId}
            options={providerOptions}
            onChange={handleProviderChange}
            size="xs"
            searchable={true}
          />
        </SettingRow>

        <SettingRow label="Model" description="Select the AI model to use">
          <Dropdown
            value={settings.aiModelId}
            options={modelOptions}
            onChange={handleModelChange}
            size="xs"
            searchable={true}
          />
        </SettingRow>
      </Section>

      {providersNeedingKeys.length > 0 && (
        <Section title="API Keys">
          {providersNeedingKeys.map((provider) => (
            <SettingRow key={provider.id} label={provider.name}>
              {renderApiKeyInput(provider.id, provider.name)}
            </SettingRow>
          ))}
        </Section>
      )}

      {providersNeedingAuth.length > 0 && (
        <Section title="Authentication">
          {providersNeedingAuth.map((provider) => (
            <SettingRow
              key={provider.id}
              label={provider.name}
              description="Requires OAuth authentication"
            >
              <div className="flex items-center gap-2 rounded border border-border bg-secondary-bg px-3 py-1.5">
                <span className="text-text-lighter text-xs">Coming Soon</span>
              </div>
            </SettingRow>
          ))}
        </Section>
      )}

      <Section title="Behavior">
        <SettingRow
          label="Auto Open Read Files"
          description="Automatically open files in the editor when AI reads them"
        >
          <Switch
            checked={settings.aiAutoOpenReadFiles}
            onChange={(checked) => updateSetting("aiAutoOpenReadFiles", checked)}
            size="sm"
          />
        </SettingRow>
      </Section>
    </div>
  );
};
