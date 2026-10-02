import { existsSync } from "node:fs";
import { beforeAll, describe } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  UI_TIMEOUT,
  click,
  contextClick,
  expandTreeFolder,
  inputValue,
  menuItem,
  treeItem,
  typeInto,
  typeText,
  waitForDisplayed,
  waitForHidden,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const CREATED = "created.ts";
const RENAMED = "renamed.ts";
const NEW_FILE_INPUT = By.css('input[aria-label="Name new file"]');
const RENAME_INPUT = By.css(`input[aria-label="Rename ${CREATED}"]`);

function waitForPath(segments: string[], present: boolean, message: string) {
  return waitUntil(() => existsSync(workspaceFile(...segments)) === present, UI_TIMEOUT, message);
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
    await click(menuItem("New File"));

    await waitForDisplayed(NEW_FILE_INPUT, "The new file name field never appeared");
    await typeInto(NEW_FILE_INPUT, CREATED);
    await typeText(Key.ENTER);

    await waitForPath(["src", CREATED], true, `${CREATED} was never created on disk`);
    await waitForDisplayed(treeItem(CREATED), `${CREATED} never appeared in the file tree`);
  });

  e2eTest("renames a file from its context menu", async () => {
    await contextClick(treeItem(CREATED));
    await waitForDisplayed(menuItem("Rename"), "The file context menu did not open");
    await click(menuItem("Rename"));

    await waitForDisplayed(RENAME_INPUT, "The rename field never appeared");
    // The field fills in the current name; whether it arrives selected is
    // timing dependent, so clear it from the end before typing.
    await waitUntil(
      async () => (await inputValue(RENAME_INPUT)) === CREATED,
      UI_TIMEOUT,
      "The rename field never showed the current name",
    );
    await click(RENAME_INPUT);
    await typeText(Key.END + Key.BACK_SPACE.repeat(CREATED.length + 2));
    await typeInto(RENAME_INPUT, RENAMED);
    await waitUntil(
      async () => (await inputValue(RENAME_INPUT)) === RENAMED,
      UI_TIMEOUT,
      "The rename field did not take the new name",
    );
    await typeText(Key.ENTER);

    await waitForHidden(RENAME_INPUT, "The rename field did not close");
    await waitForPath(["src", RENAMED], true, `${RENAMED} never appeared on disk`);
    await waitForPath(["src", CREATED], false, `${CREATED} was not renamed on disk`);
    await waitForDisplayed(treeItem(RENAMED), `${RENAMED} never appeared in the file tree`);
  });
});
