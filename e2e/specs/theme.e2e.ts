import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  UI_TIMEOUT,
  click,
  rootAttribute,
  rootStyleValue,
  runPaletteCommand,
  typeInto,
  waitForDisplayed,
  waitForHidden,
  waitForProjectTree,
  waitForSavedSetting,
  waitUntil,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

const THEME_INPUT = By.css('input[placeholder="Search themes..."]');

const LIGHT = { id: "athas-light", name: "Athas Light", type: "light" };
const DARK = { id: "athas-dark", name: "Athas Dark", type: "dark" };
type Theme = typeof LIGHT;

function themeOption(name: string) {
  return By.xpath(
    `//*[@id="theme-selector-results"]//*[@role="option"][.//*[normalize-space()="${name}"]]`,
  );
}

async function switchThemeFromPalette(theme: Theme) {
  const previousBackground = await rootStyleValue("--background");

  await runPaletteCommand("Preferences: Color Theme");
  await waitForDisplayed(THEME_INPUT, "The color theme picker did not open");
  await typeInto(THEME_INPUT, theme.name);
  await waitForDisplayed(themeOption(theme.name), `The theme picker never listed ${theme.name}`);
  await click(themeOption(theme.name));
  await waitForHidden(THEME_INPUT, "The color theme picker did not close");

  await waitUntil(
    async () => (await rootAttribute("data-theme")) === theme.id,
    UI_TIMEOUT,
    `The workbench never switched to ${theme.name}`,
  );
  expect(await rootAttribute("data-theme-type")).toBe(theme.type);
  expect(await rootStyleValue("--background")).not.toBe(previousBackground);
  await waitForSavedSetting("theme", theme.id, `${theme.name} was never saved`);
}

describe("color theme", () => {
  useAppSession("theme");

  // Start from whichever built-in theme is not active, so both switches change something.
  let first = LIGHT;
  let second = DARK;

  beforeAll(async () => {
    await waitForProjectTree();
    if ((await rootAttribute("data-theme")) === LIGHT.id) [first, second] = [DARK, LIGHT];
  });

  e2eTest("switches the theme from the command palette", async () => {
    await switchThemeFromPalette(first);
  });

  e2eTest("switches back to the other built-in theme", async () => {
    await switchThemeFromPalette(second);
  });
});
