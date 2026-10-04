import { beforeAll, describe, expect } from "bun:test";
import { By } from "selenium-webdriver";
import {
  STARTUP_TIMEOUT,
  UI_TIMEOUT,
  attribute,
  click,
  countVisible,
  editorTab,
  exists,
  runPaletteCommand,
  typeInto,
  waitForDisplayed,
  waitForEditorText,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

// Only src/farewell.ts in the fixture contains this string.
const MARKER = "athas-e2e-search-target";
const SEARCH_INPUT = By.css('input[aria-label="Search in files"]');
const RESULTS = '[data-slot="multibuffer-workspace"]';
const RESULT_HEADERS = By.css(`${RESULTS} button[aria-label^="Open "]`);
const FAREWELL_RESULT = By.css(`${RESULTS} button[aria-label^="Open "][aria-label$="farewell.ts"]`);

describe("global search", () => {
  useAppSession("global-search");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("finds a string across the project", async () => {
    await runPaletteCommand("Search: Global Search");
    await waitForDisplayed(SEARCH_INPUT, "The global search view never opened");

    await typeInto(SEARCH_INPUT, MARKER);

    await waitForDisplayed(
      FAREWELL_RESULT,
      "Global search never listed farewell.ts",
      STARTUP_TIMEOUT,
    );
    expect(await countVisible(RESULT_HEADERS)).toBe(1);
  });

  e2eTest("opens a result in the editor", async () => {
    await click(FAREWELL_RESULT);

    await waitUntil(
      () => exists(editorTab("farewell.ts")),
      UI_TIMEOUT,
      "Opening the search result did not open farewell.ts",
    );
    expect(await attribute(editorTab("farewell.ts"), "aria-selected")).toBe("true");
    await waitForEditorText(MARKER, "farewell.ts content never reached the editor");
  });
});
