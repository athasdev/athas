import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { V0_EXTENSION_ID } from "@/extensions/v0/manifest";
import { v0ExtensionModule } from "@/extensions/v0/v0-extension";

interface ExtensionActivationContext {
  extensionId: string;
  manifest: ExtensionManifest;
}

interface BundledContributionModule {
  activate: (context: ExtensionActivationContext) => void | Promise<void>;
  deactivate: (context: ExtensionActivationContext) => void | Promise<void>;
}

const bundledContributionModules = new Map<string, BundledContributionModule>([
  [V0_EXTENSION_ID, v0ExtensionModule],
]);

export async function activateBundledContributionModule(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  await bundledContributionModules.get(extensionId)?.activate({ extensionId, manifest });
}

export async function deactivateBundledContributionModule(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  await bundledContributionModules.get(extensionId)?.deactivate({ extensionId, manifest });
}
