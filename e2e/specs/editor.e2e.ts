import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  UI_TIMEOUT,
  attribute,
  click,
  editorTab,
  exists,
  expandTreeFolder,
  focusEditorAtStart,
  openFileFromTree,
  pressShortcut,
  readEditorText,
  readTextFile,
  runOnVisible,
  text,
  typeText,
  waitForDisplayed,
  waitForEditorText,
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
const NOTES_LINES = ["Athas e2e notes", "second line"];
const ACTIVE_LINE = By.css(".cm-editor .cm-content .cm-activeLine");
const ACTIVE_LINE_NUMBER = By.css(".cm-editor .cm-lineNumbers .cm-activeLineGutter");
const GO_TO_LINE_INPUT = By.css('.cm-editor .cm-goto-line input[name="line"]');
const EDITOR_CONTENT = By.css(".cm-editor .cm-content");

/** Every rendered line of the visible editor, in order. */
async function editorLines() {
  return (await readEditorText()).split("\n");
}

function waitForEditorLines(expected: string[], message: string) {
  return waitUntil(
    async () =>
      JSON.stringify((await editorLines()).slice(0, expected.length)) === JSON.stringify(expected),
    UI_TIMEOUT,
    message,
  );
}

function waitForDiskLines(filePath: string, expected: string[], message: string) {
  return waitUntil(
    () => {
      const lines = readTextFile(filePath).replace(/\r\n/g, "\n").split("\n");
      return JSON.stringify(lines.slice(0, expected.length)) === JSON.stringify(expected);
    },
    UI_TIMEOUT,
    message,
  );
}

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

  e2eTest("types on every line with multiple cursors", async () => {
    await openFileFromTree("notes.txt");
    await waitForEditorLines(NOTES_LINES, "notes.txt content never reached the editor");

    await focusEditorAtStart();
    await pressShortcut(Key.CONTROL, Key.ALT, Key.ARROW_DOWN);
    await typeText("#");

    await waitForEditorLines(
      NOTES_LINES.map((line) => `#${line}`),
      "Typing with two cursors did not edit both lines",
    );
  });

  e2eTest("undoes and redoes a multi-cursor edit as one step", async () => {
    await pressShortcut(Key.CONTROL, "z");
    await waitForEditorLines(NOTES_LINES, "Undo did not remove the edit from both lines");

    await pressShortcut(Key.CONTROL, Key.SHIFT, "z");
    const edited = NOTES_LINES.map((line) => `#${line}`);
    await waitForEditorLines(edited, "Redo did not bring the edit back on both lines");

    await pressShortcut(Key.CONTROL, "s");
    await waitForDiskLines(
      workspaceFile("notes.txt"),
      edited,
      "The redone edit never reached disk",
    );
    await waitForTabLabel("notes.txt", false);
  });

  e2eTest("renders line numbers and syntax highlighting", async () => {
    await expandTreeFolder("src");
    await openFileFromTree("greeting.ts");
    await waitForEditorText("export function greeting", "greeting.ts never reached the editor");

    await waitUntil(
      async () => {
        const numbers = await runOnVisible<string[]>(
          EDITOR_CONTENT,
          `return Array.from(
            arguments[0].closest(".cm-editor").querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
            (element) => element.textContent.trim(),
          );`,
        );
        return ["1", "2", "3"].every((number) => numbers.includes(number));
      },
      UI_TIMEOUT,
      "The line number gutter did not number the lines",
    );

    // Highlighted tokens are wrapped in styled spans; plain text has a single color.
    await waitUntil(
      async () => {
        const colors = await runOnVisible<string[]>(
          EDITOR_CONTENT,
          `return Array.from(arguments[0].querySelectorAll('.cm-line span:not([contenteditable="false"])'), (span) =>
            getComputedStyle(span).color);`,
        );
        return new Set(colors).size >= 2;
      },
      UI_TIMEOUT,
      "The TypeScript file was never syntax highlighted",
    );
  });

  e2eTest("jumps to a line with go to line", async () => {
    await focusEditorAtStart();
    await waitUntil(
      async () => (await text(ACTIVE_LINE_NUMBER)).trim() === "1",
      UI_TIMEOUT,
      "The cursor did not start on line 1",
    );

    await pressShortcut(Key.CONTROL, Key.ALT, "g");
    await waitForDisplayed(GO_TO_LINE_INPUT, "The go to line field never opened");
    await click(GO_TO_LINE_INPUT);
    await typeText(Key.END + Key.BACK_SPACE.repeat(4));
    await typeText(`2${Key.ENTER}`);

    await waitForHidden(GO_TO_LINE_INPUT, "The go to line field did not close");
    await waitUntil(
      async () => (await text(ACTIVE_LINE_NUMBER)).trim() === "2",
      UI_TIMEOUT,
      "The cursor did not move to line 2",
    );
    expect(await text(ACTIVE_LINE)).toContain("return");
  });
});
