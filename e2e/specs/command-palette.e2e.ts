import { expect } from "@wdio/globals";
import { UI_TIMEOUT, fileTree, runPaletteCommand, waitForProjectTree } from "../support/app.ts";

describe("command palette", () => {
  before(async () => {
    await waitForProjectTree();
  });

  it("opens and runs a command", async () => {
    await runPaletteCommand("View: Hide Sidebar");
    await fileTree().waitForDisplayed({
      reverse: true,
      timeout: UI_TIMEOUT,
      timeoutMsg: "Hide Sidebar did not hide the file tree",
    });

    await runPaletteCommand("View: Show Sidebar");
    await expect(fileTree()).toBeDisplayed();
  });
});
