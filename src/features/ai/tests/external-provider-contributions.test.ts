// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));

import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { useAIProviderIcon } from "../services/providers/ai-provider-icon-registry";
import { getProvider } from "../services/providers/ai-provider-registry";
import { useAIProviderSettingsActions } from "../services/providers/ai-provider-settings-registry";
import {
  registerExternalAIProvider,
  registerExternalAIProviderSettingsAction,
  unregisterExternalAIProviders,
} from "../services/providers/external-ai-provider";

const extensionId = "athas.ai.contrib-test";
const manifest = {
  id: extensionId,
  name: "contrib-test",
  displayName: "Contrib Test",
  description: "Provider contributions",
  version: "1.0.0",
  publisher: "Athas",
  categories: ["AI"],
  icon: "https://example.test/icon.png",
  aiProviders: [
    {
      id: "contrib",
      name: "Contrib",
      apiUrl: "https://example.test/chat",
      requiresApiKey: true,
      transport: "browser",
      models: [{ id: "m", name: "M" }],
    },
  ],
} as unknown as ExtensionManifest;

const request = vi.fn();
const streamRequest = { modelId: "m", messages: [], maxTokens: 10, temperature: 0 };

function register() {
  registerExternalAIProvider({ extensionId, manifest, providerId: "contrib", request });
  return getProvider("contrib")!;
}

let root: Root;
let icon: ReturnType<typeof useAIProviderIcon>;
let actionIds: string[] = [];

function Harness() {
  icon = useAIProviderIcon("contrib");
  actionIds = useAIProviderSettingsActions("contrib").map((action) => action.id);
  useAIProviderSettingsActions();
  return null;
}

async function render() {
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  request.mockReset();
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  unregisterExternalAIProviders(extensionId);
});

describe("external AI provider contributions", () => {
  it("rejects headers that are not an object and stringifies header values", async () => {
    const provider = register();
    request.mockResolvedValueOnce(["Authorization"]);
    await expect(provider.buildHeaders("k")).rejects.toThrow(
      "External AI provider returned invalid headers",
    );
    request.mockResolvedValueOnce({ "X-Retries": 3 });
    await expect(provider.buildHeaders("k")).resolves.toEqual({ "X-Retries": "3" });
    expect(request).toHaveBeenLastCalledWith("aiProvider.buildHeaders", ["contrib", "k"]);
  });

  it("falls back to the manifest URL and treats only true as a valid key", async () => {
    const provider = register();
    request.mockResolvedValueOnce("   ");
    await expect(provider.buildUrl!(streamRequest)).resolves.toBe("https://example.test/chat");
    request.mockResolvedValueOnce("yes");
    await expect(provider.validateApiKey("k")).resolves.toBe(false);
  });

  it("keeps only well-formed models from the extension", async () => {
    const provider = register();
    request.mockResolvedValueOnce([
      { id: " big ", name: "", contextWindow: 1000, maxOutputTokens: 100, maxTokens: 50 },
      { id: "" },
      null,
      ["array"],
      { id: "named", name: "Named" },
    ]);
    await expect(provider.getModels!("k")).resolves.toEqual([
      { id: "big", name: "big", contextWindow: 1000, maxOutputTokens: 100, maxTokens: 50 },
      {
        id: "named",
        name: "Named",
        contextWindow: undefined,
        maxOutputTokens: undefined,
        maxTokens: undefined,
      },
    ]);
    request.mockResolvedValueOnce({ not: "a list" });
    await expect(provider.getModels!("k")).resolves.toEqual([]);
  });

  it("refuses providers the manifest does not contribute", () => {
    expect(() =>
      registerExternalAIProvider({ extensionId, manifest, providerId: "other", request }),
    ).toThrow("Integration does not contribute AI provider other");
    expect(() =>
      registerExternalAIProviderSettingsAction({
        extensionId,
        manifest,
        providerId: "other",
        id: "a",
        label: "A",
        buttonLabel: "Run",
        execute: () => {},
      }),
    ).toThrow("Integration does not contribute AI provider other");
  });

  it("shows the extension's icon and settings actions until it is removed", async () => {
    register();
    registerExternalAIProviderSettingsAction({
      extensionId,
      manifest,
      providerId: "contrib",
      id: "contrib.theme",
      label: "Theme",
      buttonLabel: "Open",
      icon: "palette",
      execute: () => {},
    });
    await render();
    expect(icon).toBeDefined();
    expect(actionIds).toEqual(["contrib.theme"]);

    const container = document.createElement("div");
    const iconRoot = createRoot(container);
    await act(async () => iconRoot.render(createElement(icon!, { size: 20, className: "i" })));
    expect(container.innerHTML).toContain('src="https://example.test/icon.png"');
    expect(container.innerHTML).toContain('width="20"');
    await act(async () => iconRoot.unmount());

    await act(async () => unregisterExternalAIProviders(extensionId));
    expect(icon).toBeUndefined();
    expect(actionIds).toEqual([]);
    expect(getProvider("contrib")).toBeUndefined();
  });
});
