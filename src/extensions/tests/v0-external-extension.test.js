import { describe, expect, it, vi } from "vite-plus/test";
import { activate } from "../../../extensions/official/v0/main.js";

describe("external v0 extension", () => {
  it("registers the v0 provider and migrates saved design systems", async () => {
    const providers = [];
    const settingsActions = [];
    const commands = new Map();
    const storage = new Map();
    const api = {
      ai: {
        registerProvider: (provider) => providers.push(provider),
        registerSettingsAction: (action) => settingsActions.push(action),
      },
      commands: {
        register: (command) => commands.set(command.id, command.run),
      },
      dialog: { open: vi.fn() },
      http: {
        request: vi.fn(async () => ({ status: 404, body: "" })),
      },
      settings: {
        get: vi.fn(async (key) =>
          key === "v0DesignSystems"
            ? [
                {
                  id: "product",
                  name: "Product UI",
                  registryUrl: "https://example.test/r/registry.json",
                },
              ]
            : "product",
        ),
        set: vi.fn(async () => undefined),
      },
      storage: {
        get: async (key) => storage.get(key),
        set: async (key, value) => storage.set(key, value),
      },
      views: { invalidate: vi.fn() },
      ui: {},
    };

    await activate(api);

    expect(providers).toHaveLength(1);
    expect(settingsActions.at(-1)).toMatchObject({
      providerId: "v0",
      description: "Product UI",
    });
    expect(storage.get("designSystems")).toHaveLength(1);
    expect(commands.has("athas.ai.v0.openDesignSystems")).toBe(true);

    const payload = providers[0].buildPayload({
      modelId: "v0-pro",
      messages: [
        { role: "system", content: "You are Athas Agent." },
        { role: "user", content: "Create a dashboard." },
        { role: "assistant", content: "I can do that." },
        { role: "user", content: "Make it compact." },
      ],
    });
    expect(payload).toMatchObject({
      message:
        "User:\nCreate a dashboard.\n\nAssistant:\nI can do that.\n\nUser:\nMake it compact.",
      responseMode: "experimental_stream",
      chatPrivacy: "private",
      modelConfiguration: { modelId: "v0-pro" },
    });
    expect(providers[0].getSystemPromptContext()).toContain("Product UI");

    await commands.get("athas.ai.v0.selectProfile")?.("");
    expect(api.settings.set).toHaveBeenCalledWith("activeV0DesignSystemId", "");
  });
});
