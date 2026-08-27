import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { uiExtensionHost } from "../ui-extension-host";
import { useUIExtensionStore } from "../../stores/ui-extension-store";
import {
  type GeneratedUIExtension,
  normalizeGeneratedExtensionId,
  readStoredGeneratedExtensions,
  storeGeneratedExtension,
} from "./generated-ui-extension-storage";
import { validateGeneratedExtensionSource } from "./generated-ui-extension-source";
import {
  parseGeneratedExtensionPermissions,
  validateGeneratedExtensionPermissionUsage,
} from "./generated-ui-extension-permissions";

export type { GeneratedUIExtension } from "./generated-ui-extension-storage";
export { validateGeneratedExtensionSource } from "./generated-ui-extension-source";

export function wrapGeneratedExtensionSource(code: string): string {
  validateGeneratedExtensionSource(code);
  return `export async function activate(api) {\n"use strict";\n${code}\n}\n`;
}

export function createGeneratedExtensionManifest(
  extension: GeneratedUIExtension,
  extensionId = normalizeGeneratedExtensionId(extension.id),
): ExtensionManifest {
  const permissions = parseGeneratedExtensionPermissions(extension.permissions);
  validateGeneratedExtensionPermissionUsage(extension.code, permissions);
  return {
    id: extensionId,
    name: extension.name,
    displayName: extension.name,
    description: extension.description,
    version: "0.0.0",
    publisher: "athas.generated",
    categories: ["UI"],
    main: "generated.js",
    permissions,
  };
}

export async function installGeneratedUIExtension(
  extension: GeneratedUIExtension,
  options: { persist?: boolean } = {},
) {
  const store = useUIExtensionStore.getState();
  const { actions } = store;
  const extensionId = normalizeGeneratedExtensionId(extension.id);

  if (uiExtensionHost.isLoaded(extensionId)) {
    await uiExtensionHost.unloadExtension(extensionId);
  } else if (store.extensions.has(extensionId)) {
    actions.cleanupExtension(extensionId);
  }

  actions.registerExtension({
    extensionId,
    manifestId: extensionId,
    name: extension.name,
    description: extension.description,
    contributionType: extension.contributionType,
    state: "loading",
  });

  try {
    await uiExtensionHost.loadGeneratedExtension(
      createGeneratedExtensionManifest(extension, extensionId),
      wrapGeneratedExtensionSource(extension.code),
    );
    actions.registerExtension({
      extensionId,
      manifestId: extensionId,
      name: extension.name,
      description: extension.description,
      contributionType: extension.contributionType,
      state: "active",
    });
    if (options.persist !== false) {
      storeGeneratedExtension(extension);
    }
    return { extensionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Install failed";
    actions.updateExtensionState(extensionId, "error", message);
    throw new Error(message);
  }
}

export async function initializeGeneratedUIExtensions(): Promise<void> {
  for (const extension of readStoredGeneratedExtensions()) {
    try {
      await installGeneratedUIExtension(extension, { persist: false });
    } catch (error) {
      console.error("Failed to initialize generated UI extension:", error);
    }
  }
}
