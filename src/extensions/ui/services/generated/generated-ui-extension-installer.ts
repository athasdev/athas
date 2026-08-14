import { useUIExtensionStore } from "../../stores/ui-extension-store";
import { createGeneratedExtensionAPI } from "./generated-ui-extension-api";
import {
  type GeneratedUIExtension,
  normalizeGeneratedExtensionId,
  readStoredGeneratedExtensions,
  storeGeneratedExtension,
} from "./generated-ui-extension-storage";

export type { GeneratedUIExtension } from "./generated-ui-extension-storage";

export function installGeneratedUIExtension(
  extension: GeneratedUIExtension,
  options: { persist?: boolean } = {},
) {
  const store = useUIExtensionStore.getState();
  const { actions } = store;
  const extensionId = normalizeGeneratedExtensionId(extension.id);

  if (store.extensions.has(extensionId)) {
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
    const api = createGeneratedExtensionAPI(extensionId);
    const activate = Function("api", `"use strict";\n${extension.code}`);
    activate(api);
    actions.updateExtensionState(extensionId, "active");
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

export function initializeGeneratedUIExtensions(): void {
  for (const extension of readStoredGeneratedExtensions()) {
    try {
      installGeneratedUIExtension(extension, { persist: false });
    } catch (error) {
      console.error("Failed to initialize generated UI extension:", error);
    }
  }
}
