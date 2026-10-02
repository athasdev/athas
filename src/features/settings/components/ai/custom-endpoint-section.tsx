import { useEffect, useState, type KeyboardEvent } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
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
import { ArrowCounterClockwiseIcon } from "@/ui/icons";
import Input from "@/ui/input";
import Section, { SettingRow, SettingStatus } from "../settings-section";

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
    <Section title="Custom endpoint" icon={<ProviderIcon providerId="custom" />}>
      <SettingRow
        label="Server address"
        description="Any OpenAI-compatible server"
        control="field"
        activateOnClick={false}
      >
        <Input
          grow
          value={baseUrlInput}
          onChange={(event) => setBaseUrlInput(event.currentTarget.value)}
          onBlur={() => commitBaseUrl(baseUrlInput)}
          onKeyDown={blurOnEnter}
          placeholder="http://localhost:1234/v1"
          aria-label="Custom endpoint address"
          spellCheck={false}
        />
        {baseUrl !== getDefaultSetting("aiCustomBaseUrl") ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Reset address"
            aria-label="Reset custom endpoint address"
            onClick={() => commitBaseUrl(getDefaultSetting("aiCustomBaseUrl"))}
          >
            <ArrowCounterClockwiseIcon />
          </Button>
        ) : null}
      </SettingRow>
      <SettingRow label="Model" control="field" activateOnClick={false}>
        <Input
          grow
          value={modelInput}
          onChange={(event) => setModelInput(event.currentTarget.value)}
          onBlur={() => void updateSetting("aiCustomModelId", modelInput.trim())}
          onKeyDown={blurOnEnter}
          placeholder="Model name"
          aria-label="Custom endpoint model"
          spellCheck={false}
        />
      </SettingRow>
      {hasApiKey ? (
        <SettingRow
          label="API key"
          description={<SettingStatus>Configured</SettingStatus>}
          activateOnClick={false}
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => void removeApiKey()}
            disabled={isSavingApiKey}
          >
            Reset Key
          </Button>
        </SettingRow>
      ) : (
        <SettingRow label="API key" description="Optional" control="field" activateOnClick={false}>
          <Input
            type="password"
            grow
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void saveApiKey();
            }}
            placeholder="API key"
            aria-label="Custom endpoint API key"
            spellCheck={false}
            autoComplete="off"
            disabled={isSavingApiKey}
          />
          <Button
            type="button"
            onClick={() => void saveApiKey()}
            disabled={!apiKeyInput.trim() || isSavingApiKey}
          >
            Save
          </Button>
        </SettingRow>
      )}
    </Section>
  );
}
