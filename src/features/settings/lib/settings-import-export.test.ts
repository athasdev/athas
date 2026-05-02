import { describe, expect, it } from "vite-plus/test";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { createSettingsExportPayload, parseSettingsImportJson } from "./settings-import-export";

describe("settings import/export", () => {
  it("creates a versioned settings export payload", () => {
    const payload = createSettingsExportPayload({
      ...defaultSettings,
      fontSize: 15,
    });

    expect(payload.format).toBe("athas.settings");
    expect(payload.version).toBe(1);
    expect(payload.settings.fontSize).toBe(15);
  });

  it("imports raw settings objects and ignores unknown keys", () => {
    const imported = parseSettingsImportJson(
      JSON.stringify({
        fontSize: 17,
        keybindingPreset: "unknown",
        unknownSetting: true,
      }),
    );

    expect(imported?.fontSize).toBe(17);
    expect(imported?.keybindingPreset).toBe("none");
    expect("unknownSetting" in (imported as object)).toBe(false);
  });

  it("imports versioned settings payloads", () => {
    const imported = parseSettingsImportJson(
      JSON.stringify({
        format: "athas.settings",
        version: 1,
        exportedAt: "2026-04-25T00:00:00.000Z",
        settings: {
          ...defaultSettings,
          wordWrap: true,
        },
      }),
    );

    expect(imported?.wordWrap).toBe(true);
  });
});
