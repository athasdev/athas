import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import {
  registerCommandPaletteView,
  unregisterCommandPaletteViewsByExtension,
} from "@/features/command-palette/services/command-palette-view-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  registerAIProviderExtension,
  unregisterAIProviderExtension,
} from "@/features/ai/services/providers/ai-provider-registry";
import {
  registerAIProviderIcon,
  unregisterAIProviderIconsByExtension,
} from "@/features/ai/services/providers/ai-provider-icon-registry";
import {
  registerAIProviderSettingsAction,
  unregisterAIProviderSettingsActionsByExtension,
} from "@/features/ai/services/providers/ai-provider-settings-registry";
import { getManifestAIProviderContributions } from "@/extensions/types/extension-contributions";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { V0_DESIGN_SYSTEM_VIEW_ID, V0_EXTENSION_ID, V0_PROVIDER_ID } from "./manifest";
import { V0DesignSystemCommandContent } from "./components/v0-design-system-command";
import { V0Icon } from "./components/v0-icon";
import { buildV0DesignSystemPrompt, getActiveV0DesignSystem } from "./lib/v0-design-systems";
import { V0Provider } from "./providers/v0-provider";

interface ExtensionActivationContext {
  extensionId: string;
  manifest: ExtensionManifest;
}

function getV0ProviderContribution(manifest: ExtensionManifest) {
  return getManifestAIProviderContributions(manifest).find(
    (provider) => provider.id === V0_PROVIDER_ID,
  );
}

function getActiveDesignSystemDescription(): string {
  const settings = useSettingsStore.getState().settings;
  return getActiveV0DesignSystem(settings)?.name || "Use v0 defaults";
}

export const v0ExtensionModule = {
  activate({ extensionId, manifest }: ExtensionActivationContext): void {
    const provider = getV0ProviderContribution(manifest);
    if (!provider) return;

    registerAIProviderExtension({
      extensionId,
      provider,
      createProvider: (config) => new V0Provider(config),
      useTauriFetch: true,
      buildSystemPromptContext: (settings) =>
        buildV0DesignSystemPrompt(getActiveV0DesignSystem(settings)),
    });
    registerAIProviderIcon({
      extensionId,
      providerId: V0_PROVIDER_ID,
      icon: V0Icon,
    });

    registerCommandPaletteView({
      id: V0_DESIGN_SYSTEM_VIEW_ID,
      extensionId,
      render: (props) => <V0DesignSystemCommandContent {...props} />,
    });

    registerAIProviderSettingsAction({
      id: `${V0_EXTENSION_ID}.design-systems`,
      extensionId,
      providerId: V0_PROVIDER_ID,
      label: "v0 Design System",
      buttonLabel: "Select",
      commandPaletteViewId: V0_DESIGN_SYSTEM_VIEW_ID,
      icon: "palette",
      getDescription: getActiveDesignSystemDescription,
    });

    useUIExtensionStore.getState().registerCommand({
      id: `${V0_EXTENSION_ID}.designSystems`,
      extensionId,
      title: "AI: v0 Design System",
      category: "AI",
      execute: () => useUIState.getState().openCommandPaletteView(V0_DESIGN_SYSTEM_VIEW_ID),
    });
  },

  deactivate({ extensionId }: ExtensionActivationContext): void {
    unregisterAIProviderExtension(extensionId);
    unregisterAIProviderIconsByExtension(extensionId);
    unregisterAIProviderSettingsActionsByExtension(extensionId);
    unregisterCommandPaletteViewsByExtension(extensionId);
    useUIExtensionStore.getState().cleanupExtension(extensionId);
  },
};
