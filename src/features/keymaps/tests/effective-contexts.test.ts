import { describe, expect, it } from "vite-plus/test";
import { resolveEffectiveKeymapContexts } from "../utils/effective-contexts";

describe("resolveEffectiveKeymapContexts", () => {
  it("treats live Monaco/editor key targets as editor focus", () => {
    expect(
      resolveEffectiveKeymapContexts(
        { editorFocus: false, terminalFocus: false },
        { isEditorTarget: true, isTerminalTarget: false },
      ),
    ).toMatchObject({
      editorFocus: true,
      terminalFocus: false,
    });
  });

  it("preserves stored focus when the current event target is neutral", () => {
    expect(
      resolveEffectiveKeymapContexts(
        { editorFocus: true, terminalFocus: true },
        { isEditorTarget: false, isTerminalTarget: false },
      ),
    ).toMatchObject({
      editorFocus: true,
      terminalFocus: true,
    });
  });
});
