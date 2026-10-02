import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  UI_TIMEOUT,
  activateTab,
  attribute,
  closeTab,
  countVisible,
  editorTab,
  expandTreeFolder,
  isDisplayed,
  openFileFromTree,
  runPaletteCommand,
  waitForEditorText,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const PANES = By.css("[data-pane-container]");
const FILES = ["README.md", "notes.txt", "greeting.ts"];

function waitForVisibleCount(locator: By, expected: number, message: string) {
  return waitUntil(async () => (await countVisible(locator)) === expected, UI_TIMEOUT, message);
}

describe("tabs and panes", () => {
  useAppSession("tabs");

  let panesBeforeSplit = 0;

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens each file in its own tab", async () => {
    await openFileFromTree("README.md");
    await openFileFromTree("notes.txt");
    await expandTreeFolder("src");
    await openFileFromTree("greeting.ts");

    for (const file of FILES) {
      expect(await isDisplayed(editorTab(file))).toBe(true);
    }
    expect(await attribute(editorTab("greeting.ts"), "aria-selected")).toBe("true");
  });

  e2eTest("switches between tabs", async () => {
    await activateTab("README.md");
    await waitForEditorText("# Sample Project", "README.md never came back into view");
    expect(await attribute(editorTab("greeting.ts"), "aria-selected")).toBe("false");

    await activateTab("notes.txt");
    await waitForEditorText("Athas e2e notes", "notes.txt never came into view");
  });

  e2eTest("splits the editor and closes the new group", async () => {
    panesBeforeSplit = await countVisible(PANES);
    expect(panesBeforeSplit).toBeGreaterThan(0);

    await runPaletteCommand("View: Split Editor Right");

    await waitForVisibleCount(PANES, panesBeforeSplit + 1, "Splitting did not add an editor group");
    // The new group starts with the editor that was active when splitting.
    await waitForVisibleCount(editorTab("notes.txt"), 2, "The split group did not show notes.txt");

    await runPaletteCommand("View: Close Editor Group");

    await waitForVisibleCount(PANES, panesBeforeSplit, "Closing the group did not remove it");
    await waitForVisibleCount(editorTab("notes.txt"), 1, "notes.txt was not merged back");
  });

  e2eTest("closes tabs", async () => {
    await closeTab("notes.txt");
    expect(await isDisplayed(editorTab("README.md"))).toBe(true);
    expect(await isDisplayed(editorTab("greeting.ts"))).toBe(true);

    await closeTab("README.md");
    expect(await isDisplayed(editorTab("greeting.ts"))).toBe(true);
    await waitUntil(
      async () => (await attribute(editorTab("greeting.ts"), "aria-selected")) === "true",
      UI_TIMEOUT,
      "The last remaining tab did not become active",
    );
  });
});
