import { describe, expect, it } from "vite-plus/test";
import {
  getKeybindingPresetCoverageReport,
  getKeybindingPresetDefinition,
  getKeybindingPresetDiffReport,
  isKeybindingPreset,
  keybindingPresetDefinitions,
  keybindingPresetOptions,
  type KeybindingPreset,
} from "../constants/keybinding-presets";

const presets = Object.keys(keybindingPresetDefinitions) as KeybindingPreset[];

describe("keybinding presets", () => {
  it("recognizes only known presets and falls back to the built-in shortcuts", () => {
    expect(isKeybindingPreset("jetbrains")).toBe(true);
    expect(isKeybindingPreset("notepad")).toBe(false);
    expect(getKeybindingPresetDefinition("emacs").label).toBe("Emacs");
    expect(getKeybindingPresetDefinition("unknown" as KeybindingPreset)).toBe(
      keybindingPresetDefinitions.none,
    );
    expect(keybindingPresetOptions.map((option) => option.value)).toEqual(presets);
  });

  it("covers every default command in each preset", () => {
    const none = getKeybindingPresetCoverageReport("none");
    expect(none).toMatchObject({ coveredCommandIds: [], missingCommandIds: [], isComplete: true });
    expect(none.totalCommandCount).toBeGreaterThan(0);

    for (const preset of presets.filter((value) => value !== "none")) {
      const report = getKeybindingPresetCoverageReport(preset);
      expect(report.isComplete).toBe(true);
      expect(report.coveredCommandIds).toHaveLength(report.totalCommandCount);
    }
  });

  it("reports the commands a preset changes from the defaults", () => {
    const none = getKeybindingPresetDiffReport("none");
    expect(none.changedCommandIds).toEqual([]);

    const jetbrains = getKeybindingPresetDiffReport("jetbrains");
    expect(jetbrains.changedCommandIds).toEqual(
      expect.arrayContaining([
        "workbench.newWindow",
        "workbench.toggleSidebar",
        "workbench.commandPalette",
        "editor.goToDefinition",
      ]),
    );
    expect(jetbrains.unchangedCommandIds).not.toContain("workbench.commandPalette");
    expect(jetbrains.changedCommandIds.length + jetbrains.unchangedCommandIds.length).toBe(
      none.unchangedCommandIds.length,
    );
  });

  it("drops disabled commands from a preset's bindings", () => {
    const commands = keybindingPresetDefinitions.jetbrains.overrides.map(
      (binding) => binding.command,
    );
    expect(commands).not.toContain("workbench.newWindow");
    expect(
      keybindingPresetDefinitions.jetbrains.overrides.every(
        (binding) => binding.source === "preset",
      ),
    ).toBe(true);
  });
});
