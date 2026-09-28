import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_CLOUD_BASE_URL,
  isOllamaCloudUrl,
  resolveOllamaBaseUrl,
} from "@/features/ai/lib/ollama-endpoint";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";
import {
  setOllamaApiKey,
  setOllamaBaseUrl,
} from "@/features/ai/services/providers/ai-provider-registry";
import { isLocalEndpointUrl } from "@/features/ai/lib/local-ai-connection";
import { checkOllamaConnection } from "@/features/ai/services/providers/ollama-provider";
import { useToast } from "@/features/layout/contexts/toast-context";
import { getDefaultSetting } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { ArrowCounterClockwiseIcon, CloudIcon, LaptopIcon } from "@/ui/icons";
import Input from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { TextLink } from "@/ui/text-link";
import { ToggleGroup } from "@/ui/toggle-group";
import { cn } from "@/utils/cn";
import Section, { SettingRow, SettingStatus } from "../settings-section";

type OllamaStatus = "idle" | "checking" | "ok" | "error";

/** Ollama on this machine, on the local network, or on Ollama Cloud. */
export function OllamaSection() {
  const ollamaBaseUrl = useSettingsStore((state) => state.settings.ollamaBaseUrl);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const { showToast } = useToast();
  const [ollamaUrl, setOllamaUrl] = useState(ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("idle");
  const ollamaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ollamaDraftDirtyRef = useRef(false);
  const ollamaValidationIdRef = useRef(0);
  const lastSelfHostedOllamaUrlRef = useRef(
    isOllamaCloudUrl(ollamaBaseUrl)
      ? DEFAULT_OLLAMA_BASE_URL
      : resolveOllamaBaseUrl(ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL,
  );
  const [ollamaApiKeyInput, setOllamaApiKeyInput] = useState("");
  const [hasStoredOllamaKey, setHasStoredOllamaKey] = useState(false);
  const [isSavingOllamaKey, setIsSavingOllamaKey] = useState(false);
  const isOllamaCloud = isOllamaCloudUrl(ollamaUrl);

  // Keep the draft aligned with settings loaded after the page mounted.
  useEffect(() => {
    const url = resolveOllamaBaseUrl(ollamaBaseUrl) || DEFAULT_OLLAMA_BASE_URL;
    setOllamaBaseUrl(url);

    if (!isOllamaCloudUrl(url)) {
      lastSelfHostedOllamaUrlRef.current = url;
    }

    if (!ollamaDraftDirtyRef.current) {
      if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
      setOllamaUrl(url);
    }
  }, [ollamaBaseUrl]);

  useEffect(() => {
    void (async () => {
      const token = await getProviderApiToken("ollama");
      setHasStoredOllamaKey(!!token);
      setOllamaApiKey(token);
    })();
  }, []);

  useEffect(
    () => () => {
      if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
      ollamaValidationIdRef.current += 1;
    },
    [],
  );

  const validateOllamaConnection = useCallback(
    async (url: string, apiKey?: string | null) => {
      const normalizedUrl = resolveOllamaBaseUrl(url);
      const validationId = ++ollamaValidationIdRef.current;
      if (!normalizedUrl) {
        setOllamaStatus("error");
        return;
      }

      setOllamaStatus("checking");
      const keyToUse =
        apiKey !== undefined
          ? apiKey
          : hasStoredOllamaKey
            ? await getProviderApiToken("ollama")
            : null;
      const ok = await checkOllamaConnection(normalizedUrl, keyToUse);
      if (validationId === ollamaValidationIdRef.current) {
        setOllamaStatus(ok ? "ok" : "error");
      }
    },
    [hasStoredOllamaKey],
  );

  const commitOllamaUrl = useCallback(
    (value: string) => {
      if (ollamaDebounceRef.current) {
        clearTimeout(ollamaDebounceRef.current);
        ollamaDebounceRef.current = undefined;
      }

      const normalizedUrl = resolveOllamaBaseUrl(value);
      if (!normalizedUrl) {
        setOllamaStatus("error");
        return;
      }

      ollamaDraftDirtyRef.current = false;
      setOllamaUrl(normalizedUrl);
      void updateSetting("ollamaBaseUrl", normalizedUrl);
      setOllamaBaseUrl(normalizedUrl);
      if (!isOllamaCloudUrl(normalizedUrl)) {
        lastSelfHostedOllamaUrlRef.current = normalizedUrl;
      }
      void validateOllamaConnection(normalizedUrl);
    },
    [updateSetting, validateOllamaConnection],
  );

  const handleOllamaUrlChange = (value: string) => {
    ollamaDraftDirtyRef.current = true;
    setOllamaUrl(value);
    setOllamaStatus("idle");

    if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
    ollamaDebounceRef.current = setTimeout(() => {
      ollamaDebounceRef.current = undefined;
      void commitOllamaUrl(value);
    }, 600);
  };

  const handleResetOllamaUrl = () => {
    lastSelfHostedOllamaUrlRef.current = DEFAULT_OLLAMA_BASE_URL;
    commitOllamaUrl(DEFAULT_OLLAMA_BASE_URL);
  };

  const handleUseOllamaCloud = () => {
    const currentUrl = resolveOllamaBaseUrl(ollamaUrl);
    if (currentUrl && !isOllamaCloudUrl(currentUrl)) {
      lastSelfHostedOllamaUrlRef.current = currentUrl;
    }
    commitOllamaUrl(OLLAMA_CLOUD_BASE_URL);
  };

  const handleSaveOllamaApiKey = async () => {
    const trimmed = ollamaApiKeyInput.trim();
    if (!trimmed) return;
    setIsSavingOllamaKey(true);
    try {
      await storeProviderApiToken("ollama", trimmed);
      setOllamaApiKey(trimmed);
      setHasStoredOllamaKey(true);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key saved", type: "success" });
      void validateOllamaConnection(ollamaUrl, trimmed);
    } catch {
      showToast({ message: "Failed to save Ollama API key", type: "error" });
    } finally {
      setIsSavingOllamaKey(false);
    }
  };

  const handleRemoveOllamaApiKey = async () => {
    try {
      await removeProviderApiToken("ollama");
      setOllamaApiKey(null);
      setHasStoredOllamaKey(false);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key removed", type: "success" });
      void validateOllamaConnection(ollamaUrl, null);
    } catch {
      showToast({ message: "Failed to remove Ollama API key", type: "error" });
    }
  };

  const statusDot = {
    idle: { label: "Not checked", className: "bg-subtle-foreground" },
    checking: { label: "Checking", className: "bg-warning" },
    ok: { label: "Connected", className: "bg-success" },
    error: { label: "Not reachable", className: "bg-destructive" },
  }[ollamaStatus];
  const addressHint =
    ollamaStatus === "error"
      ? isOllamaCloud
        ? "Could not reach Ollama Cloud. Check your key and connection."
        : "Could not connect. Is Ollama running at this address?"
      : isOllamaCloud || isLocalEndpointUrl(resolveOllamaBaseUrl(ollamaUrl) ?? "")
        ? undefined
        : "Runs outside your local network";
  const showKey = isOllamaCloud || hasStoredOllamaKey;

  return (
    <Section
      title="Ollama"
      icon={<ProviderIcon providerId="ollama" />}
      actions={
        <ToggleGroup
          value={isOllamaCloud ? "cloud" : "local"}
          onValueChange={(nextValue) => {
            if (nextValue === "local") {
              commitOllamaUrl(lastSelfHostedOllamaUrlRef.current);
              return;
            }
            handleUseOllamaCloud();
          }}
          ariaLabel="Where Ollama runs"
          options={[
            { value: "local", label: "Local", icon: <LaptopIcon /> },
            { value: "cloud", label: "Cloud", icon: <CloudIcon /> },
          ]}
        />
      }
    >
      <SettingRow
        label="Server address"
        description={addressHint ?? statusDot.label}
        control="field"
        activateOnClick={false}
      >
        <span
          role="img"
          aria-label={statusDot.label}
          title={statusDot.label}
          className={cn("size-2 shrink-0 rounded-full", statusDot.className)}
        />
        <Input
          type="text"
          grow
          value={ollamaUrl}
          onChange={(e) => handleOllamaUrlChange(e.target.value)}
          onBlur={(e) => {
            void commitOllamaUrl(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
          placeholder={DEFAULT_OLLAMA_BASE_URL}
          spellCheck={false}
          aria-label="Ollama server address"
          aria-invalid={ollamaStatus === "error" || undefined}
        />
        {ollamaStatus === "checking" ? <Spinner label="Checking" compact /> : null}
        {ollamaBaseUrl !== getDefaultSetting("ollamaBaseUrl") ? (
          <Button
            type="button"
            variant="ghost"
            iconOnly
            onClick={handleResetOllamaUrl}
            tooltip="Reset address"
            aria-label="Reset Ollama address to default"
          >
            <ArrowCounterClockwiseIcon />
          </Button>
        ) : null}
      </SettingRow>
      {showKey && hasStoredOllamaKey ? (
        <SettingRow
          label="API key"
          description={<SettingStatus>Configured</SettingStatus>}
          activateOnClick={false}
        >
          <Button type="button" variant="ghost" onClick={() => void handleRemoveOllamaApiKey()}>
            Reset Key
          </Button>
        </SettingRow>
      ) : showKey ? (
        <SettingRow
          label="API key"
          description={
            <>
              Get a key at{" "}
              <TextLink
                href="https://ollama.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                ollama.com
              </TextLink>
            </>
          }
          control="field"
          activateOnClick={false}
        >
          <Input
            type="password"
            grow
            value={ollamaApiKeyInput}
            onChange={(e) => setOllamaApiKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void handleSaveOllamaApiKey();
            }}
            placeholder="API key"
            aria-label="Ollama API key"
            spellCheck={false}
            autoComplete="off"
            disabled={isSavingOllamaKey}
          />
          <Button
            type="button"
            onClick={() => void handleSaveOllamaApiKey()}
            disabled={!ollamaApiKeyInput.trim() || isSavingOllamaKey}
          >
            {isSavingOllamaKey ? "Saving…" : "Save"}
          </Button>
        </SettingRow>
      ) : null}
    </Section>
  );
}
