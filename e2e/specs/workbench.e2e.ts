import { describe, expect } from "bun:test";
import {
  FILE_TREE,
  attribute,
  click,
  isDisplayed,
  treeItem,
  waitForDisplayed,
  waitForProjectTree,
  waitForWorkbench,
} from "../support/app.ts";
import { driver, e2eTest, useAppSession } from "../support/session.ts";

describe("workbench", () => {
  useAppSession("workbench");

  e2eTest("launches and renders the workbench", async () => {
    await waitForWorkbench();
    expect(await driver().getTitle()).toContain("Athas");
  });

  e2eTest("opens the fixture folder passed on the command line", async () => {
    await waitForProjectTree();
    expect(await isDisplayed(FILE_TREE)).toBe(true);
    expect(await isDisplayed(treeItem("README.md"))).toBe(true);
    expect(await isDisplayed(treeItem("notes.txt"))).toBe(true);
    expect(await attribute(treeItem("src"), "data-is-dir")).toBe("true");
  });

  e2eTest("expands a folder to reveal nested files", async () => {
    await click(treeItem("src"));
    await waitForDisplayed(treeItem("greeting.ts"), "Expanding src did not show greeting.ts");
  });
});
