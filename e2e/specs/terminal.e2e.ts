import { rmSync } from "node:fs";
import { $, browser } from "@wdio/globals";
import { Key } from "webdriverio";
import {
  STARTUP_TIMEOUT,
  readTextFile,
  runPaletteCommand,
  waitForProjectTree,
} from "../support/app.ts";
import { workspaceFile } from "../support/paths.ts";

const MARKER = "athas-e2e-terminal";

function markerWritten(filePath: string) {
  try {
    return readTextFile(filePath).includes(MARKER);
  } catch {
    return false;
  }
}

describe("integrated terminal", () => {
  before(async () => {
    await waitForProjectTree();
  });

  it("runs a shell command", async () => {
    // xterm draws to a canvas, so the shell's output is checked through a side
    // effect on disk instead of scraping rendered rows.
    const outputFile = workspaceFile("terminal-output.txt");
    rmSync(outputFile, { force: true });

    await runPaletteCommand("View: Show Terminal");
    const terminal = $(".xterm");
    await terminal.waitForDisplayed({
      timeout: STARTUP_TIMEOUT,
      timeoutMsg: "The integrated terminal never rendered",
    });

    // A shell that is still starting can drop typed input, so the command is
    // retyped (after clearing the line) until the shell has run it.
    let attempt = 0;
    await browser.waitUntil(
      async () => {
        await terminal.click();
        if (attempt++ > 0) await browser.keys([Key.Ctrl, "c"]);
        await browser.keys(`echo ${MARKER} > "${outputFile}"`);
        await browser.keys(Key.Enter);
        return browser
          .waitUntil(() => markerWritten(outputFile), { timeout: 10_000, interval: 250 })
          .catch(() => false);
      },
      {
        timeout: STARTUP_TIMEOUT,
        interval: 500,
        timeoutMsg: "The terminal never ran the echo command",
      },
    );
  });
});
