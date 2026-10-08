import { describe, expect, it } from "vite-plus/test";
import type { Keybinding } from "../types/keymaps.types";
import {
  getEffectiveKeybindingForCommand,
  getEffectiveKeybindings,
  getEffectiveShortcutsByCommand,
} from "../services/effective-keymaps";

const registryKeybindings: Keybinding[] = [
  { key: "cmd+shift+p", command: "workbench.commandPalette", source: "default" },
  { key: "cmd+shift+n", command: "workbench.newWindow", source: "default" },
  { key: "cmd+b", command: "workbench.toggleSidebar", source: "default" },
  { key: "cmd+s", command: "file.save", source: "default" },
];

function keyFor(bindings: Keybinding[], command: string) {
  return bindings.filter((binding) => binding.command === command).map((binding) => binding.key);
}

describe("effective keybindings", () => {
  it("uses registry keybindings unchanged without a preset or user overrides", () => {
    expect(
      getEffectiveKeybindings({ preset: "none", registryKeybindings, userKeybindings: [] }),
    ).toEqual(registryKeybindings);
  });

  it("applies preset overrides and drops commands the preset disables", () => {
    const effective = getEffectiveKeybindings({
      preset: "jetbrains",
      registryKeybindings,
      userKeybindings: [],
    });

    expect(keyFor(effective, "workbench.commandPalette")).toEqual(["cmd+shift+a"]);
    expect(keyFor(effective, "workbench.newWindow")).toEqual([]);
    expect(keyFor(effective, "workbench.toggleSidebar")).toEqual([]);
    expect(keyFor(effective, "editor.goToReferences")).toEqual(["alt+F7"]);
  });

  it("lets user keybindings win over both the preset and the registry", () => {
    const userKeybindings: Keybinding[] = [
      { key: "cmd+alt+p", command: "workbench.commandPalette", source: "user" },
    ];
    const effective = getEffectiveKeybindings({
      preset: "jetbrains",
      registryKeybindings,
      userKeybindings,
    });

    expect(effective[0]).toBe(userKeybindings[0]);
    expect(keyFor(effective, "workbench.commandPalette")).toEqual(["cmd+alt+p"]);
    expect(keyFor(effective, "file.save")).toEqual(["cmd+s"]);
  });

  it("removes only the default rule matching an additive removal, ignoring key spelling", () => {
    const effective = getEffectiveKeybindings({
      preset: "none",
      registryKeybindings: [
        { key: "cmd+s", command: "file.save", source: "default" },
        { key: "cmd+alt+s", command: "file.save", source: "default" },
      ],
      userKeybindings: [
        {
          key: "Cmd+S",
          command: "file.save",
          source: "user",
          enabled: false,
          replaceDefaults: false,
        },
      ],
    });

    expect(effective.filter((binding) => binding.source === "default")).toEqual([
      { key: "cmd+alt+s", command: "file.save", source: "default" },
    ]);
  });

  it("keeps a default rule when the removal targets a different when clause", () => {
    const effective = getEffectiveKeybindings({
      preset: "none",
      registryKeybindings: [
        { key: "cmd+s", command: "file.save", when: "editorFocus", source: "default" },
      ],
      userKeybindings: [
        {
          key: "cmd+s",
          command: "file.save",
          when: "terminalFocus",
          source: "user",
          enabled: false,
          replaceDefaults: false,
        },
      ],
    });

    expect(effective.some((binding) => binding.source === "default")).toBe(true);
  });

  it("reports the first enabled binding for a command and falls back to a disabled one", () => {
    expect(
      getEffectiveKeybindingForCommand({
        commandId: "file.save",
        preset: "none",
        registryKeybindings,
        userKeybindings: [{ key: "cmd+s", command: "file.save", source: "user", enabled: false }],
      }),
    ).toMatchObject({ key: "cmd+s", enabled: false });

    expect(
      getEffectiveKeybindingForCommand({
        commandId: "workbench.commandPalette",
        preset: "vscode",
        registryKeybindings,
        userKeybindings: [],
      })?.source,
    ).toBe("preset");
  });

  it("maps each command to the shortcut that will actually run it", () => {
    const shortcuts = getEffectiveShortcutsByCommand({
      preset: "jetbrains",
      registryKeybindings,
      userKeybindings: [
        { key: "cmd+alt+s", command: "file.save", source: "user" },
        { key: "cmd+shift+a", command: "workbench.commandPalette", source: "user", enabled: false },
      ],
    });

    expect(shortcuts.get("file.save")).toBe("cmd+alt+s");
    expect(shortcuts.has("workbench.commandPalette")).toBe(false);
    expect(shortcuts.has("workbench.newWindow")).toBe(false);
    expect(shortcuts.get("editor.goToReferences")).toBe("alt+F7");
  });
});
