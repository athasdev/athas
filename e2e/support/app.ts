import { readFileSync } from "node:fs";
import path from "node:path";
import { By, Key, type Locator, type WebElement, until } from "selenium-webdriver";
import { runWorkspaceGit, settingsFile, workspaceDir } from "./paths.ts";
import { driver } from "./session.ts";

export { Key };

export const STARTUP_TIMEOUT = 60_000;
export const UI_TIMEOUT = 15_000;

export const FILE_TREE = By.css('[role="tree"][aria-label="File Explorer"]');
export const EDITOR_LINES = By.css(".cm-editor .cm-content");
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
 * The first match that is actually shown. Inactive tabs keep their editors
 * mounted but hidden, so the first DOM match is often not the one on screen.
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

export async function click(locator: Locator) {
  await (await visibleElement(locator)).click();
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

/** The visible editor's rendered text, with non-breaking spaces read as spaces. */
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

export async function countVisible(locator: Locator) {
  let count = 0;
  for (const element of await driver().findElements(locator)) {
    if (await element.isDisplayed()) count++;
  }
  return count;
}

export async function contextClick(locator: Locator) {
  const element = await visibleElement(locator);
  await driver().actions().contextClick(element).perform();
}

/** Types into the first visible match, which must be an empty, focusable field. */
export async function typeInto(locator: Locator, value: string) {
  await (await visibleElement(locator)).sendKeys(value);
}

/** The live value of an input, which the `value` attribute does not track. */
export async function inputValue(locator: Locator) {
  return (await (await visibleElement(locator)).getAttribute("value")) ?? "";
}

export function rootAttribute(name: string) {
  return driver().executeScript<string>(
    "return document.documentElement.getAttribute(arguments[0]) || '';",
    name,
  );
}

export function rootStyleValue(name: string) {
  return driver().executeScript<string>(
    "return getComputedStyle(document.documentElement).getPropertyValue(arguments[0]).trim();",
    name,
  );
}

export function waitForEditorText(expected: string, message: string) {
  return waitUntil(async () => (await readEditorText()).includes(expected), UI_TIMEOUT, message);
}

/** An item of the open menu, matched on its visible label. */
export function menuItem(label: string) {
  return By.xpath(
    `//*[@role="menuitem"][normalize-space()="${label}" or .//*[normalize-space()="${label}"]]`,
  );
}

/** Expands a folder in the file tree unless it is already open. */
export async function expandTreeFolder(name: string) {
  const folder = treeItem(name);
  await waitForDisplayed(folder, `The ${name} folder is missing from the file tree`);
  if ((await attribute(folder, "aria-expanded")) !== "true") await click(folder);
  await waitUntil(
    async () => (await attribute(folder, "aria-expanded")) === "true",
    UI_TIMEOUT,
    `The ${name} folder did not expand`,
  );
}

export async function activateTab(fileName: string) {
  await click(editorTab(fileName));
  await waitUntil(
    async () => (await attribute(editorTab(fileName), "aria-selected")) === "true",
    UI_TIMEOUT,
    `The ${fileName} tab never became active`,
  );
}

/** Activates a tab, then closes it with the close-editor shortcut. */
export async function closeTab(fileName: string) {
  await activateTab(fileName);
  await pressShortcut(Key.CONTROL, "w");
  await waitUntil(
    async () => !(await isDisplayed(editorTab(fileName))),
    UI_TIMEOUT,
    `The ${fileName} tab did not close`,
  );
}

const QUICK_OPEN_INPUT = By.css('input[aria-label="Search files and symbols"]');

export async function quickOpenFile(fileName: string) {
  await pressShortcut(Key.CONTROL, "p");
  await waitForDisplayed(QUICK_OPEN_INPUT, "Quick Open did not open");
  await typeInto(QUICK_OPEN_INPUT, fileName);

  const option = By.xpath(
    `//*[@id="quick-open-results"]//*[@role="option"][.//*[normalize-space()="${fileName}"]]`,
  );
  await waitForDisplayed(option, `Quick Open never listed ${fileName}`, STARTUP_TIMEOUT);
  await click(option);
  await waitForHidden(QUICK_OPEN_INPUT, "Quick Open did not close");
}

/** The settings the app has written to its store on disk. */
export function readSavedSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readTextFile(settingsFile)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function waitForSavedSetting(key: string, expected: unknown, message: string) {
  return waitUntil(() => readSavedSettings()[key] === expected, UI_TIMEOUT, message);
}

/** Paths staged in the workspace repository, with forward slashes. */
export function stagedFiles() {
  return runWorkspaceGit("diff", "--cached", "--name-only")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
