import { rmSync } from "node:fs";
import { beforeAll, describe } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  STARTUP_TIMEOUT,
  click,
  fileContains,
  pressShortcut,
  runPaletteCommand,
  typeText,
  waitForDisplayed,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const MARKER = "athas-e2e-terminal";
const TERMINAL = By.css(".xterm");

describe("integrated terminal", () => {
  useAppSession("terminal");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("runs a shell command", async () => {
    // xterm draws to a canvas, so the shell's output is checked through a side
    // effect on disk instead of scraping rendered rows.
    const outputFile = workspaceFile("terminal-output.txt");
    rmSync(outputFile, { force: true });

    await runPaletteCommand("View: Show Terminal");
    await waitForDisplayed(TERMINAL, "The integrated terminal never rendered", STARTUP_TIMEOUT);

    // A shell that is still starting can drop typed input, so the command is
    // retyped (after clearing the line) until the shell has run it.
    let attempt = 0;
    await waitUntil(
      async () => {
        await click(TERMINAL);
        if (attempt++ > 0) await pressShortcut(Key.CONTROL, "c");
        await typeText(`echo ${MARKER} > "${outputFile}"`);
        await typeText(Key.ENTER);
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (fileContains(outputFile, MARKER)) return true;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return false;
      },
      STARTUP_TIMEOUT,
      "The terminal never ran the echo command",
    );
  });
});
