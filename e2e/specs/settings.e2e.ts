import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  UI_TIMEOUT,
  click,
  closeTab,
  editorTab,
  inputValue,
  isDisplayed,
  rootStyleValue,
  runPaletteCommand,
  waitForDisplayed,
  waitForProjectTree,
  waitForSavedSetting,
  waitUntil,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const SETTINGS_TAB = "Settings";
const SETTINGS_CONTENT = By.css("[data-settings-content]");
const APPEARANCE_PAGE = By.css('[data-settings-content][aria-label="Appearance settings"]');
const APPEARANCE_NAV = By.css("#settings-tab-appearance");
const UI_FONT_SIZE_ROW = '[data-setting-row-key="uifontsize"]';
const UI_FONT_SIZE_INPUT = By.css(`${UI_FONT_SIZE_ROW} input`);
const UI_FONT_SIZE_INCREASE = By.css(`${UI_FONT_SIZE_ROW} button[aria-label="Increase value"]`);
const UI_FONT_SIZE_VARIABLE = "--app-ui-font-size";

async function appliedUiFontSize() {
  return Number.parseFloat(await rootStyleValue(UI_FONT_SIZE_VARIABLE));
}

async function openAppearanceSettings() {
  await runPaletteCommand("Preferences: Open Settings");
  await waitForDisplayed(SETTINGS_CONTENT, "The settings page never opened");
  if (!(await isDisplayed(APPEARANCE_PAGE))) await click(APPEARANCE_NAV);
  await waitForDisplayed(APPEARANCE_PAGE, "The Appearance settings page never opened");
  await waitForDisplayed(UI_FONT_SIZE_INPUT, "The UI Font Size setting is missing");
}

describe("settings", () => {
  useAppSession("settings");

  let changedSize = 0;

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens the settings page from the command palette", async () => {
    await openAppearanceSettings();
    expect(await isDisplayed(editorTab(SETTINGS_TAB))).toBe(true);
  });

  e2eTest("applies a changed UI font size to the workbench", async () => {
    const before = await appliedUiFontSize();
    expect(before).toBeGreaterThan(0);

    await click(UI_FONT_SIZE_INCREASE);

    await waitUntil(
      async () => (await appliedUiFontSize()) > before,
      UI_TIMEOUT,
      "The larger UI font size never reached the workbench",
    );
    changedSize = await appliedUiFontSize();
    expect(Number.parseFloat(await inputValue(UI_FONT_SIZE_INPUT))).toBe(changedSize);
    await waitForSavedSetting("uiFontSize", changedSize, "The UI font size was never saved");
  });

  e2eTest("keeps the changed setting after reopening settings", async () => {
    expect(changedSize).toBeGreaterThan(0);
    await closeTab(SETTINGS_TAB);

    await openAppearanceSettings();

    expect(Number.parseFloat(await inputValue(UI_FONT_SIZE_INPUT))).toBe(changedSize);
    expect(await appliedUiFontSize()).toBe(changedSize);
  });
});
