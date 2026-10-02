import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  UI_TIMEOUT,
  attribute,
  click,
  editorTab,
  exists,
  focusEditorAtStart,
  openFileFromTree,
  pressShortcut,
  readEditorText,
  readTextFile,
  text,
  typeText,
  waitForDisplayed,
  waitForFileContent,
  waitForHidden,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const UNSAVED = "(unsaved)";
const UNSAVED_DIALOG_XPATH = '//*[@role="dialog"][.//*[normalize-space()="Unsaved Changes"]]';
const UNSAVED_DIALOG = By.xpath(UNSAVED_DIALOG_XPATH);
const DONT_SAVE = By.xpath(`${UNSAVED_DIALOG_XPATH}//button[normalize-space()="Don't Save"]`);

function waitForTabLabel(fileName: string, dirty: boolean) {
  return waitUntil(
    async () => (await attribute(editorTab(fileName), "aria-label")).includes(UNSAVED) === dirty,
    UI_TIMEOUT,
    `${fileName} tab was expected to be ${dirty ? "unsaved" : "saved"}`,
  );
}

describe("editor", () => {
  useAppSession("editor");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("shows the contents of an opened file", async () => {
    await openFileFromTree("README.md");
    await waitUntil(
      async () => (await readEditorText()).includes("# Sample Project"),
      UI_TIMEOUT,
      "README.md content never reached the editor",
    );
  });

  e2eTest("persists typed edits to disk on save", async () => {
    await focusEditorAtStart();
    await typeText("Edited by e2e ");
    await waitForTabLabel("README.md", true);

    await pressShortcut(Key.CONTROL, "s");

    await waitForFileContent(
      workspaceFile("README.md"),
      "Edited by e2e # Sample Project",
      "The saved edit never reached disk",
    );
    await waitForTabLabel("README.md", false);
  });

  e2eTest("asks before closing a tab with unsaved changes", async () => {
    const notes = workspaceFile("notes.txt");
    const original = readTextFile(notes);

    await openFileFromTree("notes.txt");
    await focusEditorAtStart();
    await typeText("discard me ");
    await waitForTabLabel("notes.txt", true);

    await pressShortcut(Key.CONTROL, "w");

    await waitForDisplayed(UNSAVED_DIALOG, "Closing a dirty tab did not prompt");
    expect(await text(UNSAVED_DIALOG)).toContain("notes.txt");

    await click(DONT_SAVE);

    await waitForHidden(UNSAVED_DIALOG, "The unsaved-changes prompt did not close");
    await waitUntil(
      async () => !(await exists(editorTab("notes.txt"))),
      UI_TIMEOUT,
      "The notes.txt tab did not close",
    );
    expect(readTextFile(notes)).toBe(original);
  });
});
