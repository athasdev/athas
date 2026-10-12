import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  UI_TIMEOUT,
  attribute,
  click,
  editorTab,
  exists,
  inputValue,
  pressShortcut,
  readTextFile,
  treeItem,
  typeInto,
  typeText,
  waitForDisplayed,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const NOTEBOOK = "notebook.ipynb";
const NOTEBOOK_EDITOR = By.css("[data-notebook-editor]");
const UNSAVED = "(unsaved)";

// The fixture holds a markdown cell followed by a code cell. Both carry ids,
// so editing a cell's source keeps it mounted.
function cell(index: number) {
  return `(//*[@data-notebook-editor]//section)[${index}]`;
}

const MARKDOWN_CELL = cell(1);
const CODE_CELL = cell(2);
const MARKDOWN_SOURCE = By.xpath(`${MARKDOWN_CELL}//textarea[@aria-label="Cell source"]`);
const CODE_SOURCE = By.xpath(`${CODE_CELL}//*[@aria-label="Code cell source"]`);

function editCellButton(cellXPath: string) {
  return By.xpath(`${cellXPath}//button[@aria-label="Edit cell"]`);
}

interface SavedNotebook {
  cells: Array<{ cell_type: string; source: string | string[]; outputs?: unknown[] }>;
  nbformat: number;
}

function readSavedNotebook(): SavedNotebook | undefined {
  try {
    return JSON.parse(readTextFile(workspaceFile(NOTEBOOK))) as SavedNotebook;
  } catch {
    return undefined;
  }
}

function cellSource(notebook: SavedNotebook | undefined, index: number) {
  const source = notebook?.cells[index]?.source;
  return Array.isArray(source) ? source.join("") : (source ?? "");
}

function waitForTabLabel(dirty: boolean) {
  return waitUntil(
    async () => (await attribute(editorTab(NOTEBOOK), "aria-label")).includes(UNSAVED) === dirty,
    UI_TIMEOUT,
    `${NOTEBOOK} tab was expected to be ${dirty ? "unsaved" : "saved"}`,
  );
}

function waitForSavedCell(index: number, expected: string, message: string) {
  return waitUntil(() => cellSource(readSavedNotebook(), index) === expected, UI_TIMEOUT, message);
}

describe("notebook editor", () => {
  useAppSession("notebook");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens a notebook as cells", async () => {
    await click(treeItem(NOTEBOOK));
    await waitUntil(
      () => exists(editorTab(NOTEBOOK)),
      UI_TIMEOUT,
      "No tab opened for the notebook",
    );
    await waitForDisplayed(NOTEBOOK_EDITOR, "The notebook editor never appeared");

    await waitForDisplayed(
      By.xpath(`${MARKDOWN_CELL}//h1[contains(normalize-space(), "Sample notebook")]`),
      "The markdown cell was not rendered",
    );
    await waitForDisplayed(
      By.xpath(`${CODE_CELL}//*[contains(normalize-space(), "total = 1 + 1")]`),
      "The code cell source was not shown",
    );
  });

  e2eTest("saves an edited code cell into the notebook JSON", async () => {
    await click(editCellButton(CODE_CELL));
    await waitForDisplayed(CODE_SOURCE, "The code cell editor never opened");

    await click(CODE_SOURCE);
    await pressShortcut(Key.CONTROL, Key.END);
    await typeText(Key.ENTER);
    await typeText("answer = 42");
    await waitForTabLabel(true);

    await pressShortcut(Key.CONTROL, "s");

    await waitForSavedCell(
      1,
      "total = 1 + 1\nanswer = 42",
      "The code cell edit never reached the notebook on disk",
    );
    await waitForTabLabel(false);
    const saved = readSavedNotebook();
    expect(saved?.nbformat).toBe(4);
    expect(saved?.cells.map((item) => item.cell_type)).toEqual(["markdown", "code"]);
    expect(saved?.cells[1]?.outputs).toEqual([]);
    expect(cellSource(saved, 0)).toBe("# Sample notebook");
  });

  e2eTest("saves an edited markdown cell into the notebook JSON", async () => {
    await click(editCellButton(MARKDOWN_CELL));
    await waitForDisplayed(MARKDOWN_SOURCE, "The markdown cell editor never opened");

    // Typing into a field that is not focused appends to its current value.
    await typeInto(MARKDOWN_SOURCE, " edited");
    await waitUntil(
      async () => (await inputValue(MARKDOWN_SOURCE)) === "# Sample notebook edited",
      UI_TIMEOUT,
      "The markdown cell did not take the typed text",
    );
    await waitForTabLabel(true);

    await pressShortcut(Key.CONTROL, "s");

    await waitForSavedCell(
      0,
      "# Sample notebook edited",
      "The markdown cell edit never reached the notebook on disk",
    );
    await waitForTabLabel(false);
    expect(cellSource(readSavedNotebook(), 1)).toBe("total = 1 + 1\nanswer = 42");
  });
});
