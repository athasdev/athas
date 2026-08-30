import { describe, expect, it } from "vite-plus/test";
import { getChatPreferencesModel } from "../utils/chat-preferences-model";
import type { SessionConfigOption } from "../types/acp.types";

function option(id: string, category: SessionConfigOption["category"]): SessionConfigOption {
  return {
    id,
    name: id,
    category,
    kind: {
      type: "select",
      currentValue: "default",
      options: [{ id: "default", name: "Default" }],
    },
  };
}

describe("AI chat preferences model", () => {
  it("shows the Athas provider preferences and fallback mode in the shared composer", () => {
    const preferences = getChatPreferencesModel({
      currentAgentId: "custom",
      canChangeAgent: true,
      sessionConfigOptions: [option("agent-model", "model")],
    });

    expect(preferences).toMatchObject({
      showAgentPreference: true,
      showAthasAgentPreferences: true,
      showModePreference: true,
      acpConfigOptions: [],
    });
  });

  it("uses ACP preferences and does not duplicate a config-provided mode", () => {
    const model = option("agent-model", "model");
    const mode = option("agent-mode", "mode");
    const preferences = getChatPreferencesModel({
      currentAgentId: "codex",
      canChangeAgent: false,
      sessionConfigOptions: [model, mode],
    });

    expect(preferences.showAgentPreference).toBe(false);
    expect(preferences.showAthasAgentPreferences).toBe(false);
    expect(preferences.showModePreference).toBe(false);
    expect(preferences.acpConfigOptions).toEqual([model, mode]);
  });

  it("keeps supported ACP preferences in the agent-provided order", () => {
    const supported = [
      option("agent-model", "model"),
      option("agent-mode", "mode"),
      option("thought-level", "thought_level"),
      option("extra-model", "model"),
    ];
    const unsupported = option("theme", "theme");
    const empty = option("empty-model", "model");
    if (empty.kind.type === "select") empty.kind.options = [];
    const enabled: SessionConfigOption = {
      id: "brave-mode",
      name: "Brave mode",
      category: "mode",
      kind: { type: "boolean", currentValue: true },
    };

    const preferences = getChatPreferencesModel({
      currentAgentId: "codex",
      canChangeAgent: true,
      sessionConfigOptions: [...supported, unsupported, empty, enabled],
    });

    expect(preferences.acpConfigOptions).toEqual([...supported, unsupported, enabled]);
  });
});
