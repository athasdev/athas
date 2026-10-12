import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  STARTUP_TIMEOUT,
  UI_TIMEOUT,
  click,
  focusEditorAtStart,
  hover,
  openFileFromTree,
  pressShortcut,
  runPaletteCommand,
  stagedFiles,
  typeText,
  waitForDisplayed,
  waitForFileContent,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { runWorkspaceGit, workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

// The session setup commits the fixture, so the workspace starts clean. Each file row in the Git
// view carries its path as the title; its Stage button shows while the pointer is over the row.
const CHANGED_NOTES = By.css('[data-stream-section="changes"] [title="notes.txt"]');
const STAGED_NOTES = By.css('[data-stream-section="staged"] [title="notes.txt"]');
const STAGE_NOTES = By.css(
  '[data-stream-section="changes"] [title="notes.txt"] button[aria-label="Stage"]',
);

describe("git view", () => {
  useAppSession("git");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("lists a file edited in the editor as changed", async () => {
    expect(runWorkspaceGit("status", "--porcelain").trim()).toBe("");

    await openFileFromTree("notes.txt");
    await focusEditorAtStart();
    await typeText("changed by e2e ");
    await pressShortcut(Key.CONTROL, "s");
    await waitForFileContent(
      workspaceFile("notes.txt"),
      "changed by e2e Athas e2e notes",
      "The edit never reached disk",
    );

    await runPaletteCommand("View: Show Git");

    await waitForDisplayed(CHANGED_NOTES, "The Git view never listed notes.txt", STARTUP_TIMEOUT);
  });

  e2eTest("stages the changed file", async () => {
    await hover(CHANGED_NOTES);
    await waitForDisplayed(STAGE_NOTES, "The Stage button never showed on the notes.txt row");
    await click(STAGE_NOTES);

    await waitUntil(
      () => stagedFiles().includes("notes.txt"),
      UI_TIMEOUT,
      "Staging from the Git view never reached the index",
    );
    await waitForDisplayed(STAGED_NOTES, "notes.txt never showed as staged");
  });
});
