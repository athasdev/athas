import { readFileSync } from "node:fs";
import { $, browser } from "@wdio/globals";
import { Key } from "webdriverio";

export const STARTUP_TIMEOUT = 60_000;
export const UI_TIMEOUT = 15_000;

export async function waitForWorkbench() {
  await $('[data-slot="workbench-title-row"]').waitForExist({
    timeout: STARTUP_TIMEOUT,
    timeoutMsg: "The workbench never rendered",
  });
}

export function fileTree() {
  return $('[role="tree"][aria-label="File Explorer"]');
}

export function treeItem(name: string) {
  return $(`[role="treeitem"][data-path$="${name}"]`);
}

export async function waitForProjectTree() {
  await waitForWorkbench();
  await treeItem("README.md").waitForDisplayed({
    timeout: STARTUP_TIMEOUT,
    timeoutMsg: "The fixture project never appeared in the file tree",
  });
}

export function editorTab(fileName: string) {
  return $(`[role="tab"][aria-label^="${fileName}"]`);
}

export function editorLines() {
  return $(".monaco-editor .view-lines");
}

/** Monaco renders spaces as non-breaking spaces in its view layer. */
export async function readEditorText() {
  const text = await editorLines().getText();
  return text.replace(/ /g, " ");
}

export async function openFileFromTree(name: string) {
  await treeItem(name).click();
  await editorTab(name).waitForExist({
    timeout: UI_TIMEOUT,
    timeoutMsg: `No editor tab opened for ${name}`,
  });
  await editorLines().waitForDisplayed({ timeout: UI_TIMEOUT });
}

export async function focusEditorAtStart() {
  await editorLines().click();
  await browser.keys([Key.Ctrl, Key.Home]);
}

export async function pressShortcut(...keys: string[]) {
  await browser.keys(keys);
}

export async function runPaletteCommand(label: string) {
  await pressShortcut(Key.Ctrl, Key.Shift, "p");
  const input = $('input[placeholder="Search commands and actions..."]');
  await input.waitForDisplayed({
    timeout: UI_TIMEOUT,
    timeoutMsg: "The command palette did not open",
  });
  await input.setValue(label);

  const option = $(`//*[@role="option"][.//*[normalize-space()="${label}"]]`);
  await option.waitForDisplayed({
    timeout: UI_TIMEOUT,
    timeoutMsg: `Command "${label}" is missing from the palette`,
  });
  await option.click();
  await input.waitForDisplayed({ reverse: true, timeout: UI_TIMEOUT });
}

/** Windows PowerShell 5 redirects text as UTF-16; everything else writes UTF-8. */
export function readTextFile(filePath: string) {
  const bytes = readFileSync(filePath);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  return bytes.toString("utf8");
}

export async function waitForFileContent(filePath: string, expected: string, timeoutMsg: string) {
  await browser.waitUntil(
    () => {
      try {
        return readTextFile(filePath).includes(expected);
      } catch {
        return false;
      }
    },
    { timeout: UI_TIMEOUT, interval: 250, timeoutMsg },
  );
}
