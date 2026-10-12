import { existsSync, rmSync } from "node:fs";
import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  Key,
  STARTUP_TIMEOUT,
  UI_TIMEOUT,
  attribute,
  click,
  countVisible,
  elementRect,
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
const TERMINAL_TABS = '[role="tablist"][aria-label="Terminal tabs"]';
const TERMINAL_TAB = By.css(`${TERMINAL_TABS} [role="tab"]`);
const ACTIVE_TERMINAL = By.xpath(
  `//*[@role="tablist"][@aria-label="Terminal tabs"]//*[@data-sortable-id][.//*[@role="tab"][@aria-selected="true"]]`,
);
const ENTER_FULL_SCREEN = By.css('button[aria-label="Full screen terminal"]');
const EXIT_FULL_SCREEN = By.css('button[aria-label="Exit full screen terminal"]');

function terminalTab(id: string) {
  return By.css(`${TERMINAL_TABS} [data-sortable-id="${id}"] [role="tab"]`);
}

function activeTerminalId() {
  return attribute(ACTIVE_TERMINAL, "data-sortable-id");
}

/**
 * Types commands into the visible terminal until `done` reports their effect.
 * xterm draws to a canvas, so the shell's output is checked through a side
 * effect on disk instead of scraping rendered rows. A shell that is still
 * starting can drop typed input, so the commands are retyped (after clearing
 * the line) until the shell has run them. Every command must be safe to repeat
 * and work in bash, PowerShell, and cmd.
 */
async function runInTerminal(commands: string[], done: () => boolean, message: string) {
  let attempt = 0;
  await waitUntil(
    async () => {
      await click(TERMINAL);
      if (attempt++ > 0) await pressShortcut(Key.CONTROL, "c");
      for (const command of commands) {
        await typeText(command);
        await typeText(Key.ENTER);
      }
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (done()) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return false;
    },
    STARTUP_TIMEOUT,
    message,
  );
}

/** Writes a marker to a path relative to the shell's working directory. */
function echoTo(marker: string, relativePath: string) {
  return `echo ${marker} > ${relativePath}`;
}

describe("integrated terminal", () => {
  useAppSession("terminal");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("runs a shell command", async () => {
    const outputFile = workspaceFile("terminal-output.txt");
    rmSync(outputFile, { force: true });

    await runPaletteCommand("View: Show Terminal");
    await waitForDisplayed(TERMINAL, "The integrated terminal never rendered", STARTUP_TIMEOUT);

    await runInTerminal(
      [`echo ${MARKER} > "${outputFile}"`],
      () => fileContains(outputFile, MARKER),
      "The terminal never ran the echo command",
    );
  });

  e2eTest("keeps each terminal tab's shell separate", async () => {
    // Each tab is its own shell that starts at the project root: the first one
    // moves into src/, the second stays put, and relative writes show where
    // each ran. A relative `cd` works the same in bash, PowerShell, and cmd,
    // where an absolute one would also need `/d` to cross drives.
    const firstTabFile = workspaceFile("src", "first-tab.txt");
    const secondTabFile = workspaceFile("second-tab.txt");
    const firstTabAgainFile = workspaceFile("src", "first-tab-again.txt");

    const firstTab = await activeTerminalId();
    const tabsBefore = await countVisible(TERMINAL_TAB);

    await runInTerminal(
      ["cd src", echoTo("first-tab", "first-tab.txt")],
      () => fileContains(firstTabFile, "first-tab"),
      "The first terminal never ran its commands in src/",
    );

    await runPaletteCommand("Terminal: New Terminal");
    await waitUntil(
      async () => (await countVisible(TERMINAL_TAB)) === tabsBefore + 1,
      UI_TIMEOUT,
      "No second terminal tab opened",
    );
    await waitUntil(
      async () => (await activeTerminalId()) !== firstTab,
      UI_TIMEOUT,
      "The new terminal tab did not become active",
    );
    const secondTab = await activeTerminalId();
    await waitUntil(
      async () => (await countVisible(TERMINAL)) === 1,
      UI_TIMEOUT,
      "More than one terminal is shown at once",
    );

    await runInTerminal(
      [echoTo("second-tab", "second-tab.txt")],
      () => fileContains(secondTabFile, "second-tab"),
      "The second terminal never ran its command at the project root",
    );
    expect(existsSync(workspaceFile("src", "second-tab.txt"))).toBe(false);

    await click(terminalTab(firstTab));
    await waitUntil(
      async () => (await activeTerminalId()) === firstTab,
      UI_TIMEOUT,
      "Switching back did not activate the first terminal",
    );
    expect(await attribute(terminalTab(secondTab), "aria-selected")).toBe("false");

    await runInTerminal(
      [echoTo("first-tab-again", "first-tab-again.txt")],
      () => fileContains(firstTabAgainFile, "first-tab-again"),
      "The first terminal lost its shell after switching tabs",
    );
    expect(existsSync(workspaceFile("first-tab-again.txt"))).toBe(false);
  });

  e2eTest("keeps working after the terminal is resized", async () => {
    const outputFile = workspaceFile("resized-terminal.txt");
    rmSync(outputFile, { force: true });
    const { height } = await elementRect(TERMINAL);

    await click(ENTER_FULL_SCREEN);
    await waitForDisplayed(EXIT_FULL_SCREEN, "The terminal did not go full screen");
    await waitUntil(
      async () => (await elementRect(TERMINAL)).height > height,
      UI_TIMEOUT,
      "The terminal did not grow when going full screen",
    );
    const fullScreenHeight = (await elementRect(TERMINAL)).height;

    await runInTerminal(
      [`echo resized > "${outputFile}"`],
      () => fileContains(outputFile, "resized"),
      "The resized terminal never ran the echo command",
    );

    await click(EXIT_FULL_SCREEN);
    await waitForDisplayed(ENTER_FULL_SCREEN, "The terminal did not leave full screen");
    await waitUntil(
      async () => (await elementRect(TERMINAL)).height < fullScreenHeight,
      UI_TIMEOUT,
      "The terminal did not shrink when leaving full screen",
    );
  });
});
