import { rmSync } from "node:fs";
import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  STARTUP_TIMEOUT,
  click,
  fileContains,
  readTextFile,
  treeItem,
  waitForHidden,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const MARKER = "athas-e2e-external-editor";
const OUTPUT_FILE = workspaceFile("external-editor-output.txt");
const TERMINAL = By.css(".xterm");

// A stand-in "editor" that needs nothing installed: it records the file it was
// asked to open and exits, which is what closes the external editor tab. The
// external editor terminal starts the system default shell (bash on Linux,
// cmd.exe on Windows), and both understand `&&`.
const EDITOR_COMMAND = `echo ${MARKER} $FILE > "${OUTPUT_FILE}" && exit`;

describe("external editor", () => {
  useAppSession("external-editor", {
    settings: { externalEditor: "custom", customEditorCommand: EDITOR_COMMAND },
  });

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens text files in the configured terminal editor", async () => {
    rmSync(OUTPUT_FILE, { force: true });
    const original = readTextFile(workspaceFile("notes.txt"));

    // The stand-in editor runs and exits within moments, so its terminal can open and close
    // between two polls; the file it writes is the proof that the terminal ran it.
    await click(treeItem("notes.txt"));
    await waitUntil(
      () => fileContains(OUTPUT_FILE, MARKER),
      STARTUP_TIMEOUT,
      "The external editor command never ran",
    );
    expect(readTextFile(OUTPUT_FILE)).toContain("notes.txt");

    // The command exits the shell, and the tab closes with it.
    await waitForHidden(TERMINAL, "The external editor tab stayed open after the editor exited");
    expect(readTextFile(workspaceFile("notes.txt"))).toBe(original);
  });
});
