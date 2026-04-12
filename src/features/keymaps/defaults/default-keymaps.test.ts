import { describe, expect, it } from "vite-plus/test";
import { defaultKeymaps } from "./default-keymaps";

describe("default keymaps", () => {
  it("includes bindings for showing the files and git sidebars", () => {
    expect(defaultKeymaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cmd+shift+e",
          command: "workbench.showFiles",
          source: "default",
        }),
        expect.objectContaining({
          key: "cmd+shift+g",
          command: "workbench.showGit",
          source: "default",
        }),
      ]),
    );
  });
});
