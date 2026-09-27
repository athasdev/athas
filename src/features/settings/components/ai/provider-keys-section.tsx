import { useEffect, useState } from "react";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { useAIProviderSettingsActions } from "@/features/ai/services/providers/ai-provider-settings-registry";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import { PaletteIcon, SparkleIcon, TrashIcon } from "@/ui/icons";
import Section, { SettingRow } from "../settings-section";

/** One row per provider that takes an API key, with its connection state. */
export function ProviderKeysSection() {
  const providers = useAvailableProviders().filter((provider) => provider.requiresApiKey);
  const providerKeys = useAIChatStore((state) => state.providerApiKeys);
  const chatActions = useAIChatStore((state) => state.actions);
  const extensionActions = useAIProviderSettingsActions();
  const policy = useAuthStore((state) => state.subscription?.enterprise?.policy);
  const byokAllowed = policy?.managedMode ? policy.allowByok : true;
  const { showToast } = useToast();
  const [keyDialogProviderId, setKeyDialogProviderId] = useState<string | null>(null);

  useEffect(() => {
    void chatActions.checkAllProviderApiKeys();
  }, [chatActions]);

  const disconnect = async (providerId: string, providerName: string) => {
    const confirmed = await showConfirmDialog(
      `Remove your ${providerName} API key from this device? Chats that use ${providerName} will stop working until you add a key again.`,
      { title: `Disconnect ${providerName}`, confirmLabel: "Disconnect" },
    );
    if (!confirmed) return;
    try {
      await chatActions.removeApiKey(providerId);
      showToast({ message: `${providerName} disconnected`, type: "success" });
    } catch {
      showToast({ message: `Could not remove the ${providerName} key`, type: "error" });
    }
  };

  return (
    <>
      <Section
        title="Your API keys"
        description={
          byokAllowed
            ? "Use your own provider accounts. Keys stay in this device's keychain and requests go straight to the provider."
            : "Your organization does not allow personal API keys."
        }
      >
        {providers.map((provider) => {
          const connected = providerKeys.get(provider.id) ?? false;
          return (
            <SettingRow
              key={provider.id}
              label={provider.name}
              labelAccessory={connected ? <Badge tone="success">Connected</Badge> : null}
              activateOnClick={false}
            >
              <div className="flex items-center gap-1">
                <Button disabled={!byokAllowed} onClick={() => setKeyDialogProviderId(provider.id)}>
                  {connected ? "Change key" : "Add key"}
                </Button>
                {connected ? (
                  <Button
                    variant="ghost"
                    tone="danger"
                    iconOnly
                    tooltip="Disconnect"
                    aria-label={`Disconnect ${provider.name}`}
                    onClick={() => void disconnect(provider.id, provider.name)}
                  >
                    <TrashIcon />
                  </Button>
                ) : null}
              </div>
            </SettingRow>
          );
        })}
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
      <ProviderApiKeyCommand
        isOpen={keyDialogProviderId !== null}
        onClose={() => setKeyDialogProviderId(null)}
        initialProviderId={keyDialogProviderId}
      />
    </>
  );
}
