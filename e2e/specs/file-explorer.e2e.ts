import { existsSync } from "node:fs";
import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  EDITOR_LINES,
  Key,
  UI_TIMEOUT,
  activateTab,
  attribute,
  click,
  contextClick,
  editorTab,
  expandTreeFolder,
  focusEditorAtStart,
  inputValue,
  menuItem,
  openFileFromTree,
  pressShortcut,
  readTextFile,
  treeItem,
  typeInto,
  typeText,
  waitForDisplayed,
  waitForFileContent,
  waitForHidden,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const CREATED = "created.ts";
const RENAMED = "renamed.ts";
const NEW_FILE_INPUT = By.css('input[aria-label="Name new file"]');
const UNSAVED = "(unsaved)";

function waitForPath(segments: string[], present: boolean, message: string) {
  return waitUntil(() => existsSync(workspaceFile(...segments)) === present, UI_TIMEOUT, message);
}

// The context menu re-renders while it opens, so an item found a moment earlier can go stale.
// Find it again until the click lands.
async function clickMenuItem(label: string) {
  await waitUntil(
    async () => {
      await click(menuItem(label));
      return true;
    },
    UI_TIMEOUT,
    `Could not click the "${label}" menu item`,
  );
}

async function renameFromContextMenu(currentName: string, newName: string) {
  const renameInput = By.css(`input[aria-label="Rename ${currentName}"]`);

  await contextClick(treeItem(currentName));
  await waitForDisplayed(menuItem("Rename"), `The ${currentName} context menu did not open`);
  await clickMenuItem("Rename");

  await waitForDisplayed(renameInput, "The rename field never appeared");
  // The field fills in the current name; whether it arrives selected is
  // timing dependent, so clear it from the end before typing.
  await waitUntil(
    async () => (await inputValue(renameInput)) === currentName,
    UI_TIMEOUT,
    "The rename field never showed the current name",
  );
  await click(renameInput);
  await typeText(Key.END + Key.BACK_SPACE.repeat(currentName.length + 2));
  await typeInto(renameInput, newName);
  await waitUntil(
    async () => (await inputValue(renameInput)) === newName,
    UI_TIMEOUT,
    "The rename field did not take the new name",
  );
  await typeText(Key.ENTER);
  await waitForHidden(renameInput, "The rename field did not close");
}

describe("file explorer", () => {
  useAppSession("file-explorer");

  beforeAll(async () => {
    await waitForProjectTree();
    await expandTreeFolder("src");
  });

  e2eTest("creates a file from the folder context menu", async () => {
    await contextClick(treeItem("src"));
    await waitForDisplayed(menuItem("New File"), "The folder context menu did not open");
    await clickMenuItem("New File");

    await waitForDisplayed(NEW_FILE_INPUT, "The new file name field never appeared");
    await typeInto(NEW_FILE_INPUT, CREATED);
    await typeText(Key.ENTER);

    await waitForPath(["src", CREATED], true, `${CREATED} was never created on disk`);
    await waitForDisplayed(treeItem(CREATED), `${CREATED} never appeared in the file tree`);
  });

  e2eTest("renames a file from its context menu", async () => {
    await renameFromContextMenu(CREATED, RENAMED);

    await waitForPath(["src", RENAMED], true, `${RENAMED} never appeared on disk`);
    await waitForPath(["src", CREATED], false, `${CREATED} was not renamed on disk`);
    await waitForDisplayed(treeItem(RENAMED), `${RENAMED} never appeared in the file tree`);
  });

  e2eTest("duplicates a file from its context menu", async () => {
    const original = readTextFile(workspaceFile("src", "greeting.ts"));

    await contextClick(treeItem("greeting.ts"));
    await waitForDisplayed(menuItem("Duplicate"), "The file context menu did not open");
    await clickMenuItem("Duplicate");

    await waitForPath(["src", "greeting_copy.ts"], true, "greeting_copy.ts never appeared on disk");
    await waitUntil(
      () => readTextFile(workspaceFile("src", "greeting_copy.ts")) === original,
      UI_TIMEOUT,
      "The duplicate does not match the original's contents",
    );
    await waitForDisplayed(
      treeItem("greeting_copy.ts"),
      "greeting_copy.ts never appeared in the file tree",
    );
    expect(readTextFile(workspaceFile("src", "greeting.ts"))).toBe(original);
  });

  e2eTest("saves an open file to its new path after its folder is renamed", async () => {
    const tabPath = By.css('[role="tab"][aria-label^="util.ts"] span[title]');

    await expandTreeFolder("lib");
    await openFileFromTree("util.ts");
    await focusEditorAtStart();
    await typeText("// moved ");
    await waitUntil(
      async () => (await attribute(editorTab("util.ts"), "aria-label")).includes(UNSAVED),
      UI_TIMEOUT,
      "util.ts tab never showed unsaved changes",
    );

    await renameFromContextMenu("lib", "helpers");

    await waitForPath(["src", "helpers", "util.ts"], true, "The folder was not renamed on disk");
    await waitForPath(["src", "lib"], false, "The old folder is still on disk");
    await waitForDisplayed(treeItem("helpers"), "The renamed folder never appeared in the tree");
    // The open tab follows the file to its new location before anything is saved.
    await waitUntil(
      async () =>
        (await attribute(tabPath, "title")).replace(/\\/g, "/").endsWith("src/helpers/util.ts"),
      UI_TIMEOUT,
      "The util.ts tab still points at the old folder",
    );

    await activateTab("util.ts");
    await click(EDITOR_LINES);
    await pressShortcut(Key.CONTROL, "s");

    await waitForFileContent(
      workspaceFile("src", "helpers", "util.ts"),
      "// moved export function shout",
      "The edit was not saved to the renamed folder",
    );
    await waitUntil(
      async () => !(await attribute(editorTab("util.ts"), "aria-label")).includes(UNSAVED),
      UI_TIMEOUT,
      "util.ts tab still shows unsaved changes after saving",
    );
    expect(existsSync(workspaceFile("src", "lib"))).toBe(false);
  });
});
