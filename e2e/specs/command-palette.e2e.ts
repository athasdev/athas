import { beforeAll, describe } from "bun:test";
import {
  FILE_TREE,
  runPaletteCommand,
  waitForDisplayed,
  waitForHidden,
  waitForProjectTree,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

describe("command palette", () => {
  useAppSession("command-palette");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens and runs a command", async () => {
    await runPaletteCommand("View: Hide Sidebar");
    await waitForHidden(FILE_TREE, "Hide Sidebar did not hide the file tree");

    await runPaletteCommand("View: Show Sidebar");
    await waitForDisplayed(FILE_TREE, "Show Sidebar did not bring the file tree back");
  });
});
