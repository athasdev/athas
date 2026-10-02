import { describe, expect, it } from "vite-plus/test";
import type { KeybindingPreset } from "../defaults/keybinding-presets";
import type { Keybinding } from "../types/keymaps.types";
import { getEffectiveKeybindings } from "../utils/effective-keymaps";
import { findConflictingKeybindings } from "../utils/keybinding-conflicts";

const registryKeybindings: Keybinding[] = [
  { key: "cmd+s", command: "file.save", source: "default" },
  { key: "cmd+shift+p", command: "workbench.commandPalette", source: "default" },
  { key: "cmd+d", command: "editor.addSelection", source: "default", when: "editorFocus" },
];

function conflictsFor(
  keybinding: string,
  commandId: string,
  userKeybindings: Keybinding[] = [],
  when?: string,
  preset: KeybindingPreset = "none",
) {
  return findConflictingKeybindings({
    keybinding,
    commandId,
    when,
    effectiveKeybindings: getEffectiveKeybindings({ preset, registryKeybindings, userKeybindings }),
  }).map((binding) => binding.command);
}

describe("findConflictingKeybindings", () => {
  it("reports a user binding that lands on a built-in shortcut", () => {
    const userKeybindings: Keybinding[] = [
      { key: "cmd+s", command: "workbench.toggleSidebar", source: "user", enabled: true },
    ];

    expect(conflictsFor("cmd+s", "workbench.toggleSidebar", userKeybindings)).toEqual([
      "file.save",
    ]);
    expect(conflictsFor("cmd+s", "file.save", userKeybindings)).toEqual([
      "workbench.toggleSidebar",
    ]);
  });

  it("compares keys after normalizing case and modifier order", () => {
    expect(conflictsFor("Cmd+S", "workbench.toggleSidebar")).toEqual(["file.save"]);
    expect(conflictsFor("shift+cmd+P", "workbench.toggleSidebar")).toEqual([
      "workbench.commandPalette",
    ]);
  });

  it("ignores the command being edited and bindings the user disabled", () => {
    expect(conflictsFor("cmd+s", "file.save")).toEqual([]);

    const userKeybindings: Keybinding[] = [
      { key: "cmd+s", command: "file.save", source: "user", enabled: false },
    ];
    expect(conflictsFor("cmd+s", "workbench.toggleSidebar", userKeybindings)).toEqual([]);
  });

  it("drops a default once the user rebinds that command elsewhere", () => {
    const userKeybindings: Keybinding[] = [
      { key: "cmd+alt+s", command: "file.save", source: "user", enabled: true },
    ];

    expect(conflictsFor("cmd+s", "workbench.toggleSidebar", userKeybindings)).toEqual([]);
    expect(conflictsFor("cmd+alt+s", "workbench.toggleSidebar", userKeybindings)).toEqual([
      "file.save",
    ]);
  });

  it("treats only identical when clauses as conflicting", () => {
    expect(conflictsFor("cmd+d", "editor.duplicate", [], "editorFocus")).toEqual([
      "editor.addSelection",
    ]);
    expect(conflictsFor("cmd+d", "editor.duplicate", [], " editorFocus ")).toEqual([
      "editor.addSelection",
    ]);
    expect(conflictsFor("cmd+d", "terminal.split", [], "terminalFocus")).toEqual([]);
    expect(conflictsFor("cmd+d", "workbench.bookmark")).toEqual([]);
  });

  it("follows the active preset instead of the registry defaults", () => {
    expect(
      conflictsFor("cmd+shift+a", "workbench.toggleSidebar", [], undefined, "jetbrains"),
    ).toEqual(["workbench.commandPalette"]);
    expect(
      conflictsFor("cmd+shift+p", "workbench.toggleSidebar", [], undefined, "jetbrains"),
    ).toEqual([]);
  });
});
