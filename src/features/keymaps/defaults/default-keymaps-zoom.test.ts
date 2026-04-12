import { describe, expect, it } from "vite-plus/test";
import { defaultKeymaps } from "./default-keymaps";

describe("default keymaps zoom bindings", () => {
  it("supports both equals and shifted plus for zooming in", () => {
    expect(defaultKeymaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cmd+=",
          command: "workbench.zoomIn",
          source: "default",
        }),
        expect.objectContaining({
          key: "cmd+shift+=",
          command: "workbench.zoomIn",
          source: "default",
        }),
      ]),
    );
  });
});
