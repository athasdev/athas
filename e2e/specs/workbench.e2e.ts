import { browser, expect } from "@wdio/globals";
import { fileTree, treeItem, waitForProjectTree, waitForWorkbench } from "../support/app.ts";

describe("workbench", () => {
  it("launches and renders the workbench", async () => {
    await waitForWorkbench();
    await expect(browser).toHaveTitle(expect.stringContaining("Athas"));
  });

  it("opens the fixture folder passed on the command line", async () => {
    await waitForProjectTree();
    await expect(fileTree()).toBeDisplayed();
    await expect(treeItem("README.md")).toBeDisplayed();
    await expect(treeItem("notes.txt")).toBeDisplayed();
    await expect(treeItem("src")).toHaveAttribute("data-is-dir", "true");
  });

  it("expands a folder to reveal nested files", async () => {
    await treeItem("src").click();
    await expect(treeItem("greeting.ts")).toBeDisplayed();
  });
});
