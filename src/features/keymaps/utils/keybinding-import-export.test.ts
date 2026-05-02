import { describe, expect, it } from "vite-plus/test";
import {
  createKeybindingsExportPayload,
  getExportableUserKeybindings,
  parseKeybindingsImportJson,
} from "./keybinding-import-export";

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
      keybindings: [
        {
          key: "cmd+p",
          command: "file.quickOpen",
          source: "user",
          enabled: true,
        },
      ],
    });
  });

  it("exports and imports the selected keybinding preset", () => {
    const exported = createKeybindingsExportPayload({
      keybindingPreset: "vscode",
      keybindings: [],
    });

    const imported = parseKeybindingsImportJson(JSON.stringify(exported));

    expect(imported).toEqual({
      keybindingPreset: "vscode",
      keybindings: [],
    });
  });
});
