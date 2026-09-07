import { describe, expect, it } from "vite-plus/test";
import {
  describeTerminalLinkHint,
  isTerminalLinkModifierPressed,
  resolveExternalLinkTarget,
} from "../utils/terminal-link-activation";

describe("terminal link activation", () => {
  it("requires the platform command modifier before following a link", () => {
    expect(isTerminalLinkModifierPressed({ metaKey: true, ctrlKey: false }, "macos")).toBe(true);
    expect(isTerminalLinkModifierPressed({ metaKey: false, ctrlKey: true }, "macos")).toBe(false);
    expect(isTerminalLinkModifierPressed({ metaKey: false, ctrlKey: true }, "linux")).toBe(true);
    expect(isTerminalLinkModifierPressed({ metaKey: true, ctrlKey: false }, "windows")).toBe(false);
  });

  it("describes the hint with the platform modifier", () => {
    expect(describeTerminalLinkHint("file", "macos")).toBe("⌘+click to open in editor");
    expect(describeTerminalLinkHint("url", "linux")).toBe("Ctrl+click to open link");
  });

  it("only opens web and mail links externally", () => {
    expect(resolveExternalLinkTarget("https://athas.dev/docs")).toBe("https://athas.dev/docs");
    expect(resolveExternalLinkTarget(" mailto:hey@athas.dev ")).toBe("mailto:hey@athas.dev");
    expect(resolveExternalLinkTarget("file:///etc/passwd")).toBeNull();
    expect(resolveExternalLinkTarget("javascript:alert(1)")).toBeNull();
    expect(resolveExternalLinkTarget("not a url")).toBeNull();
  });
});
