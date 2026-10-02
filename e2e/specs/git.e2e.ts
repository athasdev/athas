import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  STARTUP_TIMEOUT,
  UI_TIMEOUT,
  click,
  focusEditorAtStart,
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

// The session setup commits the fixture, so the workspace starts clean.
const CHANGED_FILES = '[role="region"][aria-label="Changed files"]';
const STAGE_NOTES = By.css(`${CHANGED_FILES} [aria-label="Stage notes.txt"]`);
const UNSTAGE_NOTES = By.css(`${CHANGED_FILES} [aria-label="Unstage notes.txt"]`);

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

    await waitForDisplayed(STAGE_NOTES, "The Git view never listed notes.txt", STARTUP_TIMEOUT);
  });

  e2eTest("stages the changed file", async () => {
    await click(STAGE_NOTES);

    await waitUntil(
      () => stagedFiles().includes("notes.txt"),
      UI_TIMEOUT,
      "Staging from the Git view never reached the index",
    );
    await waitForDisplayed(UNSTAGE_NOTES, "notes.txt never showed as staged");
  });
});
