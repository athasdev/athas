import { describe, expect, it } from "vite-plus/test";
import { evaluateWhenClause } from "../utils/context";

describe("when clause evaluation", () => {
  it("treats a missing or empty clause as always active", () => {
    expect(evaluateWhenClause(undefined, {})).toBe(true);
    expect(evaluateWhenClause("", { editorFocus: false })).toBe(true);
    expect(evaluateWhenClause("   ", {})).toBe(true);
  });

  it("reads context keys and treats unknown keys as false", () => {
    expect(evaluateWhenClause("editorFocus", { editorFocus: true })).toBe(true);
    expect(evaluateWhenClause("editorFocus", { editorFocus: false })).toBe(false);
    expect(evaluateWhenClause("someExtension.panelVisible", {})).toBe(false);
    expect(
      evaluateWhenClause("someExtension.panelVisible", { "someExtension.panelVisible": true }),
    ).toBe(true);
  });

  it("supports negation, including double negation", () => {
    expect(evaluateWhenClause("!vimMode", { vimMode: false })).toBe(true);
    expect(evaluateWhenClause("!vimMode", { vimMode: true })).toBe(false);
    expect(evaluateWhenClause("!!vimMode", { vimMode: true })).toBe(true);
  });

  it("gives && higher precedence than ||", () => {
    const context = { editorFocus: false, terminalFocus: true, vimMode: false };

    expect(evaluateWhenClause("editorFocus && vimMode || terminalFocus", context)).toBe(true);
    expect(evaluateWhenClause("terminalFocus || editorFocus && vimMode", context)).toBe(true);
    expect(evaluateWhenClause("editorFocus || terminalFocus && vimMode", context)).toBe(false);
  });

  it("respects parentheses over default precedence", () => {
    const context = { editorFocus: false, terminalFocus: true, vimMode: false };

    expect(evaluateWhenClause("(editorFocus || terminalFocus) && !vimMode", context)).toBe(true);
    expect(evaluateWhenClause("(editorFocus || terminalFocus) && vimMode", context)).toBe(false);
    expect(evaluateWhenClause("!(editorFocus || terminalFocus)", context)).toBe(false);
  });

  it("evaluates boolean literals", () => {
    expect(evaluateWhenClause("true", {})).toBe(true);
    expect(evaluateWhenClause("false", {})).toBe(false);
    expect(evaluateWhenClause("editorFocus && false", { editorFocus: true })).toBe(false);
  });

  it("compares context keys against literals with == and !=", () => {
    expect(evaluateWhenClause("vimMode == false", { vimMode: false })).toBe(true);
    expect(evaluateWhenClause("vimMode == false", { vimMode: true })).toBe(false);
    expect(evaluateWhenClause("vimMode != true", { vimMode: true })).toBe(false);
    expect(evaluateWhenClause("vimMode != true", {})).toBe(true);
    expect(evaluateWhenClause("editorFocus == 'true'", { editorFocus: true })).toBe(true);
  });

  it("keeps evaluating the rest of an expression after a comparison", () => {
    expect(evaluateWhenClause("vimMode == false && editorFocus", { editorFocus: false })).toBe(
      false,
    );
    expect(
      evaluateWhenClause("editorLangId == typescript || terminalFocus", { terminalFocus: true }),
    ).toBe(true);
    expect(evaluateWhenClause("editorLangId == typescript", {})).toBe(false);
    expect(evaluateWhenClause("editorLangId != typescript", {})).toBe(true);
  });
});
