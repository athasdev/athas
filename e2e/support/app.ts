import { readFileSync } from "node:fs";
import path from "node:path";
import {
  By,
  Key,
  type Locator,
  type WebElement,
  error as seleniumError,
  until,
} from "selenium-webdriver";
import { workspaceDir } from "./paths.ts";
import { driver } from "./session.ts";

export { Key };

export const STARTUP_TIMEOUT = 60_000;
export const UI_TIMEOUT = 15_000;

export const FILE_TREE = By.css('[role="tree"][aria-label="File Explorer"]');
export const EDITOR_LINES = By.css(".monaco-editor .view-lines");
const WORKBENCH = By.css('[data-slot="workbench-title-row"]');
const PALETTE_INPUT = By.css('input[placeholder="Search commands and actions..."]');

export function treeItem(name: string) {
  return By.css(`[role="treeitem"][data-path$="${name}"]`);
}

export function editorTab(fileName: string) {
  return By.css(`[role="tab"][aria-label^="${fileName}"]`);
}

/** Polls a condition, treating thrown errors (stale or missing nodes) as "not yet". */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeout: number,
  message: string,
) {
  await driver().wait(
    async () => {
      try {
        return await condition();
      } catch {
        return false;
      }
    },
    timeout,
    message,
  );
}

/**
 * The first match that is actually shown. Inactive tabs keep their Monaco
 * editors mounted but hidden, so the first DOM match is often not the one on
 * screen.
 */
async function findVisible(locator: Locator): Promise<WebElement | undefined> {
  for (const element of await driver().findElements(locator)) {
    if (await element.isDisplayed()) return element;
  }
  return undefined;
}

async function visibleElement(locator: Locator) {
  const element = await findVisible(locator);
  if (!element) throw new Error(`No visible element matches ${locator}`);
  return element;
}

export async function isDisplayed(locator: Locator) {
  return (await findVisible(locator)) !== undefined;
}

export async function exists(locator: Locator) {
  return (await driver().findElements(locator)).length > 0;
}

export function waitForDisplayed(locator: Locator, message: string, timeout = UI_TIMEOUT) {
  return waitUntil(() => isDisplayed(locator), timeout, message);
}

export function waitForHidden(locator: Locator, message: string, timeout = UI_TIMEOUT) {
  return waitUntil(async () => !(await isDisplayed(locator)), timeout, message);
}

function isTransientClickError(error: unknown) {
  return (
    error instanceof seleniumError.ElementClickInterceptedError ||
    error instanceof seleniumError.StaleElementReferenceError
  );
}

/**
 * Clicks the first visible match that accepts the click. While a view is being
 * replaced, the previous tab's editor can still be visible under the new one,
 * so an intercepted or stale match falls through to the next one, and the
 * whole lookup is retried until the UI settles.
 */
export async function click(locator: Locator) {
  const deadline = Date.now() + UI_TIMEOUT;
  for (;;) {
    let lastError: unknown = new Error(`No visible element matches ${locator}`);
    for (const element of await driver().findElements(locator)) {
      try {
        if (!(await element.isDisplayed())) continue;
        await element.click();
        return;
      } catch (error) {
        if (!isTransientClickError(error)) throw error;
        lastError = error;
      }
    }
    if (Date.now() > deadline) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function attribute(locator: Locator, name: string) {
  return (await (await visibleElement(locator)).getAttribute(name)) ?? "";
}

export async function text(locator: Locator) {
  return (await visibleElement(locator)).getText();
}

export async function waitForWorkbench() {
  await driver().wait(
    until.elementLocated(WORKBENCH),
    STARTUP_TIMEOUT,
    "The workbench never rendered",
  );
}

export async function waitForProjectTree() {
  await waitForWorkbench();
  // The project root row can come up collapsed; expand it like a user would.
  const root = treeItem(path.basename(workspaceDir));
  const readme = treeItem("README.md");
  await waitUntil(
    async () => (await isDisplayed(readme)) || (await isDisplayed(root)),
    STARTUP_TIMEOUT,
    "The fixture project never appeared in the file tree",
  );
  if ((await isDisplayed(root)) && (await attribute(root, "aria-expanded")) === "false") {
    await click(root);
  }
  await waitForDisplayed(
    treeItem("README.md"),
    "The fixture project never appeared in the file tree",
    STARTUP_TIMEOUT,
  );
}

/** Monaco renders spaces as non-breaking spaces in its view layer. */
export async function readEditorText() {
  const text = await (await visibleElement(EDITOR_LINES)).getText();
  return text.replace(/\u00a0/g, " ");
}

export async function openFileFromTree(name: string) {
  await click(treeItem(name));
  await waitUntil(() => exists(editorTab(name)), UI_TIMEOUT, `No editor tab opened for ${name}`);
  await waitForDisplayed(EDITOR_LINES, `The editor for ${name} never appeared`);
}

/** Presses a chord such as Ctrl+Shift+P: every key but the last is held down. */
export async function pressShortcut(...keys: string[]) {
  const modifiers = keys.slice(0, -1);
  let actions = driver().actions();
  for (const modifier of modifiers) actions = actions.keyDown(modifier);
  actions = actions.sendKeys(keys[keys.length - 1]);
  for (const modifier of modifiers.reverse()) actions = actions.keyUp(modifier);
  await actions.perform();
}

/** Types into whatever element currently has focus. */
export async function typeText(text: string) {
  await driver().actions().sendKeys(text).perform();
}

export async function focusEditorAtStart() {
  await click(EDITOR_LINES);
  await pressShortcut(Key.CONTROL, Key.HOME);
}

export async function runPaletteCommand(label: string) {
  await pressShortcut(Key.CONTROL, Key.SHIFT, "p");
  await waitForDisplayed(PALETTE_INPUT, "The command palette did not open");
  const input = await visibleElement(PALETTE_INPUT);
  await input.clear();
  await input.sendKeys(label);

  const option = By.xpath(`//*[@role="option"][.//*[normalize-space()="${label}"]]`);
  await waitForDisplayed(option, `Command "${label}" is missing from the palette`);
  await click(option);
  await waitForHidden(PALETTE_INPUT, "The command palette did not close");
}

/** Windows PowerShell 5 redirects text as UTF-16; everything else writes UTF-8. */
export function readTextFile(filePath: string) {
  const bytes = readFileSync(filePath);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  return bytes.toString("utf8");
}

export function fileContains(filePath: string, expected: string) {
  try {
    return readTextFile(filePath).includes(expected);
  } catch {
    return false;
  }
}

export function waitForFileContent(filePath: string, expected: string, message: string) {
  return waitUntil(() => fileContains(filePath, expected), UI_TIMEOUT, message);
}
