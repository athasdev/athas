import { describe, expect, test } from "bun:test";
import {
  EMPTY_EDITOR_CONTEXT_ACTIONS,
  EMPTY_EDITOR_PRIMARY_ACTIONS,
} from "./empty-editor-state-actions";

describe("empty editor state action descriptors", () => {
  test("keeps Open Harness as the only Harness entry in the primary action list", () => {
    const labels = EMPTY_EDITOR_PRIMARY_ACTIONS.map((action) => action.label);

    expect(labels).toContain("Open Harness");
    expect(labels).not.toContain("New Harness Session");
  });

  test("keeps Open Harness as the only Harness entry in the context menu", () => {
    const labels = EMPTY_EDITOR_CONTEXT_ACTIONS.map((action) => action.label);

    expect(labels).toContain("Open Harness");
    expect(labels).not.toContain("New Harness Session");
  });
});
