import { useEffect, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { getProviderApiKeyUrl } from "@/features/ai/components/provider-api-key-command";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { useAIProviderSettingsActions } from "@/features/ai/services/providers/ai-provider-settings-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { ModelProvider } from "@/features/ai/types/providers.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { PaletteIcon, SparkleIcon } from "@/ui/icons";
import Input from "@/ui/input";
import { TextLink } from "@/ui/text-link";
import Section, { SettingRow, SettingStatus } from "../settings-section";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ProviderKeyRow({
  provider,
  connected,
  byokAllowed,
}: {
  provider: ModelProvider;
  connected: boolean;
  byokAllowed: boolean;
}) {
  const chatActions = useAIChatStore((state) => state.actions);
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "invalid">("idle");
  const keyUrl = getProviderApiKeyUrl(provider);

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setStatus("saving");
    try {
      const valid = await chatActions.saveApiKey(provider.id, key);
      if (!valid) {
        setStatus("invalid");
        return;
      }
      setDraft("");
      setStatus("idle");
    } catch {
      setStatus("invalid");
    }
  };

  const reset = async () => {
    const confirmed = await showConfirmDialog(
      `Remove your ${provider.name} API key from this device?`,
      { title: `Reset ${provider.name} key`, confirmLabel: "Reset" },
    );
    if (!confirmed) return;
    try {
      await chatActions.removeApiKey(provider.id);
    } catch {
      showToast({ message: `Could not remove the ${provider.name} key`, type: "error" });
    }
  };

  const hint = !byokAllowed ? (
    "Turned off by your organization"
  ) : status === "invalid" ? (
    <SettingStatus tone="danger">That key did not work</SettingStatus>
  ) : keyUrl ? (
    <>
      Get a key at{" "}
      <TextLink href={keyUrl} target="_blank" rel="noopener noreferrer">
        {hostOf(keyUrl)}
      </TextLink>
    </>
  ) : (
    "Stored in your keychain"
  );

  if (connected) {
    return (
      <SettingRow
        label={`${provider.name} API key`}
        labelContent={provider.name}
        icon={<ProviderIcon providerId={provider.id} />}
        description={<SettingStatus>API key configured</SettingStatus>}
        activateOnClick={false}
      >
        <Button variant="ghost" onClick={() => void reset()}>
          Reset Key
        </Button>
      </SettingRow>
    );
  }

  return (
    <SettingRow
      label={`${provider.name} API key`}
      labelContent={provider.name}
      icon={<ProviderIcon providerId={provider.id} />}
      description={hint}
      control="field"
      activateOnClick={false}
    >
      <Input
        type="password"
        grow
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (status === "invalid") setStatus("idle");
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void save();
        }}
        placeholder="API key"
        aria-label={`${provider.name} API key`}
        aria-invalid={status === "invalid" || undefined}
        disabled={!byokAllowed || status === "saving"}
      />
      <Button
        onClick={() => void save()}
        disabled={!byokAllowed || !draft.trim() || status === "saving"}
      >
        {status === "saving" ? "Checking…" : "Save"}
      </Button>
    </SettingRow>
  );
}

/** Every provider that takes an API key, one row each. */
export function ProviderKeysSection() {
  const providers = useAvailableProviders().filter((provider) => provider.requiresApiKey);
  const providerKeys = useAIChatStore((state) => state.providerApiKeys);
  const chatActions = useAIChatStore((state) => state.actions);
  const extensionActions = useAIProviderSettingsActions();
  const policy = useAuthStore((state) => state.subscription?.enterprise?.policy);
  const byokAllowed = policy?.managedMode ? policy.allowByok : true;

  useEffect(() => {
    void chatActions.checkAllProviderApiKeys();
  }, [chatActions]);

  return (
    <>
      <Section title="API keys">
        {providers.map((provider) => (
          <ProviderKeyRow
            key={provider.id}
            provider={provider}
            connected={providerKeys.get(provider.id) ?? false}
            byokAllowed={byokAllowed}
          />
        ))}
      </Section>
      {extensionActions.length > 0 ? (
        <Section title="From extensions">
          {extensionActions.map((action) => {
            const Icon = action.icon === "sparkles" ? SparkleIcon : PaletteIcon;
            return (
              <SettingRow
                key={action.id}
                label={action.label}
                description={action.getDescription?.() || action.description}
              >
                <Button onClick={() => void action.execute()}>
                  <Icon />
                  <span>{action.buttonLabel}</span>
                </Button>
              </SettingRow>
            );
          })}
        </Section>
      ) : null}
    </>
  );
}
