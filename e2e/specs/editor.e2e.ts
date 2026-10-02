import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import {
  UI_TIMEOUT,
  editorTab,
  focusEditorAtStart,
  openFileFromTree,
  pressShortcut,
  readEditorText,
  readTextFile,
  waitForFileContent,
  waitForProjectTree,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";

const UNSAVED = expect.stringContaining("(unsaved)");

describe("editor", () => {
  before(async () => {
    await waitForProjectTree();
  });

  it("shows the contents of an opened file", async () => {
    await openFileFromTree("README.md");
    await browser.waitUntil(async () => (await readEditorText()).includes("# Sample Project"), {
      timeout: UI_TIMEOUT,
      timeoutMsg: "README.md content never reached the editor",
    });
  });

  it("persists typed edits to disk on save", async () => {
    await focusEditorAtStart();
    await browser.keys("Edited by e2e ");
    await expect(editorTab("README.md")).toHaveAttribute("aria-label", UNSAVED);

    await pressShortcut(Key.Ctrl, "s");

    await waitForFileContent(
      workspaceFile("README.md"),
      "Edited by e2e # Sample Project",
      "The saved edit never reached disk",
    );
    await expect(editorTab("README.md")).not.toHaveAttribute("aria-label", UNSAVED);
  });

  it("asks before closing a tab with unsaved changes", async () => {
    const notes = workspaceFile("notes.txt");
    const original = readTextFile(notes);

    await openFileFromTree("notes.txt");
    await focusEditorAtStart();
    await browser.keys("discard me ");
    await expect(editorTab("notes.txt")).toHaveAttribute("aria-label", UNSAVED);

    await pressShortcut(Key.Ctrl, "w");

    const dialog = $('//*[@role="dialog"][.//*[normalize-space()="Unsaved Changes"]]');
    await dialog.waitForDisplayed({
      timeout: UI_TIMEOUT,
      timeoutMsg: "Closing a dirty tab did not prompt",
    });
    await expect(dialog).toHaveText(expect.stringContaining("notes.txt"));

    await dialog.$(`.//button[normalize-space()="Don't Save"]`).click();

    await dialog.waitForDisplayed({ reverse: true, timeout: UI_TIMEOUT });
    await editorTab("notes.txt").waitForExist({ reverse: true, timeout: UI_TIMEOUT });
    expect(readTextFile(notes)).toBe(original);
  });
});
