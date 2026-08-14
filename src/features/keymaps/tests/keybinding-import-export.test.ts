import { describe, expect, it } from "vite-plus/test";
import {
  createKeybindingsExportPayload,
  getExportableUserKeybindings,
  mergeImportedUserKeybindings,
  parseKeybindingsImportJson,
} from "../utils/keybinding-import-export";
import {
  getEffectiveKeybindingForCommand,
  getEffectiveKeybindings,
} from "../utils/effective-keymaps";

describe("keybinding import/export", () => {
  it("exports persisted user overrides even when legacy records are missing source", () => {
    const exported = getExportableUserKeybindings([
      {
        key: "cmd+k",
        command: "workbench.commandPalette",
        source: undefined as never,
      },
    ]);

    expect(exported).toEqual([
      {
        key: "cmd+k",
        command: "workbench.commandPalette",
        source: "user",
        enabled: true,
      },
    ]);
  });

  it("imports legacy array files as user keybindings", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        {
          key: "cmd+p",
          command: "file.quickOpen",
          source: "default",
        },
      ]),
    );

    expect(imported).toEqual({
      format: "athas",
      keybindings: [
        {
          key: "cmd+p",
          command: "file.quickOpen",
          source: "user",
          enabled: true,
        },
      ],
      issues: [],
    });
  });

  it("preserves the order of legacy Athas array files", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        { key: "cmd+p", command: "file.quickOpen" },
        { key: "cmd+s", command: "file.save" },
      ]),
    );

    expect(imported?.keybindings.map((keybinding) => keybinding.command)).toEqual([
      "file.quickOpen",
      "file.save",
    ]);
  });

  it("exports and imports the selected keybinding preset", () => {
    const exported = createKeybindingsExportPayload({
      keybindingPreset: "vscode",
      keybindings: [],
    });

    const imported = parseKeybindingsImportJson(JSON.stringify(exported));

    expect(imported).toEqual({
      format: "athas",
      keybindingPreset: "vscode",
      keybindings: [],
      issues: [],
    });
  });

  it("parses VS Code JSONC and translates commands, scan codes, and contexts", () => {
    const imported = parseKeybindingsImportJson(
      `[
        // VS Code user keybindings support comments and trailing commas.
        {
          "key": "cmd+[Slash]",
          "command": "editor.action.commentLine",
          "when": "editorTextFocus && !editorReadonly",
        },
      ]`,
      { platform: "macos" },
    );

    expect(imported).toEqual({
      format: "vscode",
      keybindings: [
        {
          key: "cmd+/",
          command: "editor.toggleComment",
          source: "user",
          enabled: true,
          replaceDefaults: false,
          when: "editorFocus",
        },
      ],
      issues: [],
    });
  });

  it("uses the current platform override from contributed VS Code keybindings", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        {
          key: "ctrl+p",
          mac: "cmd+p",
          command: "workbench.action.quickOpen",
        },
      ]),
      { platform: "macos" },
    );

    expect(imported?.keybindings[0].key).toBe("cmd+p");
  });

  it("maps common VS Code workbench, editor, navigation, terminal, and view commands", () => {
    const commands = [
      ["workbench.action.files.save", "file.save"],
      ["workbench.action.showCommands", "workbench.commandPalette"],
      ["editor.action.formatDocument", "editor.formatDocument"],
      ["editor.action.revealDefinition", "editor.goToDefinition"],
      ["workbench.action.terminal.toggleTerminal", "workbench.toggleTerminal"],
      ["workbench.action.findInFiles", "workbench.showGlobalSearch"],
      ["workbench.view.explorer", "workbench.showFileExplorer"],
      ["workbench.action.openSettings", "workbench.openSettings"],
    ];
    const imported = parseKeybindingsImportJson(
      JSON.stringify(
        commands.map(([command], index) => ({
          key: `cmd+${index + 1}`,
          command,
        })),
      ),
      { platform: "macos" },
    );

    expect(imported?.keybindings.map((keybinding) => keybinding.command)).toEqual(
      commands.map(([, command]) => command).reverse(),
    );
    expect(imported?.issues).toEqual([]);
  });

  it("preserves VS Code rule precedence, duplicate contexts, and removal rules", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        {
          key: "cmd+shift+p",
          command: "-workbench.action.showCommands",
        },
        {
          key: "cmd+shift+p",
          command: "workbench.action.showCommands",
          when: "editorTextFocus",
        },
        {
          key: "cmd+shift+p",
          command: "workbench.action.showCommands",
          when: "terminalFocus",
        },
      ]),
      { platform: "macos" },
    );

    expect(imported?.keybindings).toEqual([
      {
        key: "cmd+shift+p",
        command: "workbench.commandPalette",
        source: "user",
        enabled: true,
        replaceDefaults: false,
        when: "terminalFocus",
      },
      {
        key: "cmd+shift+p",
        command: "workbench.commandPalette",
        source: "user",
        enabled: true,
        replaceDefaults: false,
        when: "editorFocus",
      },
      {
        key: "cmd+shift+p",
        command: "workbench.commandPalette",
        source: "user",
        enabled: false,
        replaceDefaults: false,
      },
    ]);
  });

  it("reports entries Athas cannot execute instead of importing broken shortcuts", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        { key: "cmd+k", command: "publisher.extensionCommand" },
        {
          key: "cmd+r",
          command: "editor.action.rename",
          when: "editorLangId == typescript",
        },
        {
          key: "cmd+f",
          command: "workbench.action.quickOpen",
          args: { prefix: "src" },
        },
        { key: "cmd+meta+p", command: "workbench.action.quickOpen" },
        { key: "cmd+p" },
      ]),
      { platform: "linux" },
    );

    expect(imported?.keybindings).toEqual([]);
    expect(imported?.issues).toEqual([
      { index: 4, reason: "invalid-entry" },
      {
        index: 3,
        reason: "unsupported-key",
        command: "workbench.action.quickOpen",
      },
      {
        index: 2,
        reason: "unsupported-arguments",
        command: "workbench.action.quickOpen",
      },
      {
        index: 1,
        reason: "unsupported-when",
        command: "editor.action.rename",
      },
      {
        index: 0,
        reason: "unknown-command",
        command: "publisher.extensionCommand",
      },
    ]);
  });

  it("recognizes installed extension commands supplied by the command registry", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([{ key: "cmd+k cmd+x", command: "publisher.extensionCommand" }]),
      {
        commandIds: ["publisher.extensionCommand"],
        platform: "macos",
      },
    );

    expect(imported?.keybindings).toEqual([
      {
        key: "cmd+k cmd+x",
        command: "publisher.extensionCommand",
        source: "user",
        enabled: true,
      },
    ]);
    expect(imported?.issues).toEqual([]);
  });

  it("merges an import atomically while preserving multiple rules per command", () => {
    const merged = mergeImportedUserKeybindings(
      [
        { key: "cmd+p", command: "file.quickOpen", source: "user" },
        { key: "cmd+s", command: "file.save", source: "user" },
      ],
      [
        {
          key: "cmd+shift+p",
          command: "file.quickOpen",
          source: "user",
          when: "editorFocus",
          replaceDefaults: false,
        },
        {
          key: "ctrl+shift+p",
          command: "file.quickOpen",
          source: "user",
          when: "terminalFocus",
          replaceDefaults: false,
        },
      ],
    );

    expect(merged).toEqual([
      {
        key: "cmd+shift+p",
        command: "file.quickOpen",
        source: "user",
        enabled: true,
        when: "editorFocus",
        replaceDefaults: false,
      },
      {
        key: "ctrl+shift+p",
        command: "file.quickOpen",
        source: "user",
        enabled: true,
        when: "terminalFocus",
        replaceDefaults: false,
      },
      {
        key: "cmd+s",
        command: "file.save",
        source: "user",
        enabled: true,
      },
    ]);
  });

  it("replaces built-in rules as a group without dropping imported contextual bindings", () => {
    const userKeybindings = mergeImportedUserKeybindings(
      [],
      [
        {
          key: "cmd+f",
          command: "workbench.showFind",
          source: "user",
          enabled: true,
          when: "editorFocus",
        },
        {
          key: "cmd+f",
          command: "workbench.showFind",
          source: "user",
          enabled: true,
          when: "terminalFocus",
        },
      ],
    );
    const effective = getEffectiveKeybindings({
      preset: "none",
      registryKeybindings: [
        {
          key: "ctrl+f",
          command: "workbench.showFind",
          source: "default",
          when: "editorFocus",
        },
        { key: "cmd+s", command: "file.save", source: "default" },
      ],
      userKeybindings,
    });

    expect(effective).toEqual([
      ...userKeybindings,
      { key: "cmd+s", command: "file.save", source: "default" },
    ]);
  });

  it("adds VS Code rules alongside defaults and removes only the matching default rule", () => {
    const imported = parseKeybindingsImportJson(
      JSON.stringify([
        { key: "cmd+p", command: "-workbench.action.quickOpen" },
        { key: "cmd+shift+p", command: "workbench.action.quickOpen" },
      ]),
      { platform: "macos" },
    );
    const effective = getEffectiveKeybindings({
      preset: "none",
      registryKeybindings: [
        { key: "cmd+p", command: "file.quickOpen", source: "default" },
        { key: "ctrl+p", command: "file.quickOpen", source: "default" },
        { key: "cmd+s", command: "file.save", source: "default" },
      ],
      userKeybindings: mergeImportedUserKeybindings([], imported?.keybindings ?? []),
    });

    expect(effective).toEqual([
      ...(imported?.keybindings ?? []),
      { key: "ctrl+p", command: "file.quickOpen", source: "default" },
      { key: "cmd+s", command: "file.save", source: "default" },
    ]);
  });

  it("shows an active imported rule ahead of a removal rule for the same command", () => {
    const active = getEffectiveKeybindingForCommand({
      commandId: "workbench.commandPalette",
      preset: "none",
      registryKeybindings: [],
      userKeybindings: [
        {
          key: "cmd+shift+p",
          command: "workbench.commandPalette",
          source: "user",
          enabled: false,
        },
        {
          key: "cmd+p",
          command: "workbench.commandPalette",
          source: "user",
          enabled: true,
        },
      ],
    });

    expect(active?.key).toBe("cmd+p");
  });
});
