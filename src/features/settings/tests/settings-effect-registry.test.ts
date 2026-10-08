import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Settings } from "../types/settings.types";

let registry: typeof import("../services/settings-effect-registry");

beforeEach(async () => {
  vi.resetModules();
  registry = await import("../services/settings-effect-registry");
});

const settings = { fontSize: 14, tabSize: 2 } as Settings;

describe("settings effect registry", () => {
  it("gives an effect registered late the settings as changed since they loaded", () => {
    registry.runSettingsEffects(settings);
    registry.runSettingEffect("fontSize", 18);

    const applyAll = vi.fn();
    registry.registerSettingsEffect("late", { applyAll });

    expect(applyAll).toHaveBeenCalledWith({ fontSize: 18, tabSize: 2 });
    expect(settings.fontSize).toBe(14);
  });

  it("replaces an effect registered again under the same id", () => {
    const first = { applyAll: vi.fn(), applyChange: vi.fn() };
    const reloaded = { applyAll: vi.fn(), applyChange: vi.fn() };
    registry.registerSettingsEffect("ai", first);
    registry.registerSettingsEffect("ai", reloaded);

    registry.runSettingsEffects(settings);
    registry.runSettingEffect("tabSize", 4);

    expect(first.applyAll).not.toHaveBeenCalled();
    expect(first.applyChange).not.toHaveBeenCalled();
    expect(reloaded.applyAll).toHaveBeenCalledTimes(1);
    expect(reloaded.applyChange).toHaveBeenCalledWith("tabSize", 4);
  });
});
