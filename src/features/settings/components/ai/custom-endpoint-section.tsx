import { useEffect, useState, type KeyboardEvent } from "react";
import { CUSTOM_CHAT_PROVIDER_ID } from "@/features/ai/lib/custom-provider-config";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";
import { setCustomProviderBaseUrl } from "@/features/ai/services/providers/ai-provider-registry";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { GlobeIcon, KeyIcon, TrashIcon } from "@/ui/icons";
import Input from "@/ui/input";
import Section, { SettingRow } from "../settings-section";

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.blur();
}

/** Any OpenAI-compatible server, such as LM Studio, vLLM, or a company gateway. */
export function CustomEndpointSection() {
  const baseUrl = useSettingsStore((state) => state.settings.aiCustomBaseUrl);
  const modelId = useSettingsStore((state) => state.settings.aiCustomModelId);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { showToast } = useToast();
  const [baseUrlInput, setBaseUrlInput] = useState(baseUrl);
  const [modelInput, setModelInput] = useState(modelId);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);

  useEffect(() => setBaseUrlInput(baseUrl), [baseUrl]);
  useEffect(() => setModelInput(modelId), [modelId]);
  useEffect(() => {
    void getProviderApiToken(CUSTOM_CHAT_PROVIDER_ID).then((token) => setHasApiKey(Boolean(token)));
  }, []);

  const commitBaseUrl = (value: string) => {
    void updateSetting("aiCustomBaseUrl", value);
    setCustomProviderBaseUrl(value);
  };

  const saveApiKey = async () => {
    const token = apiKeyInput.trim();
    if (!token) return;
    setIsSavingApiKey(true);
    try {
      await storeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID, token);
      setHasApiKey(true);
      setApiKeyInput("");
      showToast({ message: "Custom endpoint API key saved", type: "success" });
    } catch {
      showToast({ message: "Failed to save custom endpoint API key", type: "error" });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const removeApiKey = async () => {
    setIsSavingApiKey(true);
    try {
      await removeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID);
      setHasApiKey(false);
      setApiKeyInput("");
      showToast({ message: "Custom endpoint API key removed", type: "success" });
    } catch {
      showToast({ message: "Failed to remove custom endpoint API key", type: "error" });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  return (
    <Section
      title="Custom endpoint"
      description="Any OpenAI-compatible server, such as LM Studio or vLLM. Its model shows up as Custom in model menus."
    >
      <SettingRow
        label="Server address"
        description="Base URL of the OpenAI-compatible API."
        onReset={() => commitBaseUrl(getDefaultSetting("aiCustomBaseUrl"))}
        canReset={baseUrl !== getDefaultSetting("aiCustomBaseUrl")}
        resetLabel="Reset custom endpoint address"
      >
        <span className="inline-flex min-w-0 w-56 max-w-full">
          <Input
            value={baseUrlInput}
            onChange={(event) => setBaseUrlInput(event.currentTarget.value)}
            onBlur={() => commitBaseUrl(baseUrlInput)}
            onKeyDown={blurOnEnter}
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
            leftIcon={GlobeIcon}
          />
        </span>
      </SettingRow>
      <SettingRow label="Model" description="Model name sent to the server.">
        <span className="inline-flex min-w-0 w-56 max-w-full">
          <Input
            value={modelInput}
            onChange={(event) => setModelInput(event.currentTarget.value)}
            onBlur={() => void updateSetting("aiCustomModelId", modelInput.trim())}
            onKeyDown={blurOnEnter}
            placeholder="Model name"
            spellCheck={false}
          />
        </span>
      </SettingRow>
      <SettingRow
        label="API key"
        description={hasApiKey ? "Saved on this device." : "Optional, if the server requires one."}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex min-w-0 w-56 max-w-full">
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.currentTarget.value)}
              placeholder={hasApiKey ? "Saved" : "API key"}
              spellCheck={false}
              autoComplete="off"
              disabled={isSavingApiKey}
              leftIcon={KeyIcon}
            />
          </span>
          <Button
            type="button"
            onClick={() => void saveApiKey()}
            disabled={!apiKeyInput.trim() || isSavingApiKey}
          >
            Save
          </Button>
          {hasApiKey ? (
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              iconOnly
              tooltip="Remove saved API key"
              aria-label="Remove saved custom endpoint API key"
              onClick={() => void removeApiKey()}
              disabled={isSavingApiKey}
            >
              <TrashIcon />
            </Button>
          ) : null}
        </div>
      </SettingRow>
    </Section>
  );
}
