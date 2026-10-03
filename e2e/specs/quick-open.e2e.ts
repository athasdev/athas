import { beforeAll, describe, expect } from "bun:test";
import {
  UI_TIMEOUT,
  attribute,
  editorTab,
  exists,
  quickOpenFile,
  waitForEditorText,
  waitForProjectTree,
  waitUntil,
} from "../support/app.ts";
import { e2eTest, useAppSession } from "../support/session.ts";

describe("quick open", () => {
  useAppSession("quick-open");

  beforeAll(async () => {
    await waitForProjectTree();
  });

  e2eTest("opens a nested file by name", async () => {
    // farewell.ts sits in a folder the tree has not expanded, so only the
    // file index can find it.
    await quickOpenFile("farewell.ts");

    await waitUntil(
      () => exists(editorTab("farewell.ts")),
      UI_TIMEOUT,
      "Quick Open did not open a tab for farewell.ts",
    );
    expect(await attribute(editorTab("farewell.ts"), "aria-selected")).toBe("true");
    await waitForEditorText("Goodbye, ", "farewell.ts content never reached the editor");
  });
});
