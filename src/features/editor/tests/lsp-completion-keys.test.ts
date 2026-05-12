import { describe, expect, it } from "vite-plus/test";
import { resolveLspCompletionKeyAction } from "../utils/lsp-completion-keys";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";

function completion(label: string): FilteredCompletion {
  return {
    item: { label },
    score: 1,
    indices: [],
  };
}

const completions = [
  completion("alpha"),
  completion("beta"),
  completion("gamma"),
  completion("delta"),
  completion("epsilon"),
  completion("zeta"),
];

describe("lsp completion key resolution", () => {
  it("wraps arrow navigation through visible completions", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "ArrowDown" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: completions.length - 1,
      }),
    ).toEqual({ type: "select", selectedIndex: 0 });

    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "ArrowUp" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 0,
      }),
    ).toEqual({ type: "select", selectedIndex: completions.length - 1 });
  });

  it("supports page and boundary navigation", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "PageDown" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 1,
      }),
    ).toEqual({ type: "select", selectedIndex: 5 });

    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "PageUp" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 4,
      }),
    ).toEqual({ type: "select", selectedIndex: 0 });

    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "End" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 2,
      }),
    ).toEqual({ type: "select", selectedIndex: 5 });

    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "Home" },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 2,
      }),
    ).toEqual({ type: "select", selectedIndex: 0 });
  });

  it("normalizes stale selected index when applying a completion", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "Enter" },
        isVisible: true,
        filteredCompletions: completions.slice(0, 2),
        selectedIndex: 8,
      }),
    ).toEqual({
      type: "apply",
      completion: { label: "alpha" },
      selectedIndex: 0,
    });
  });

  it("hides an empty completion menu on escape", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "Escape" },
        isVisible: true,
        filteredCompletions: [],
        selectedIndex: 0,
      }),
    ).toEqual({ type: "hide" });
  });

  it("does not capture modified keybindings or hidden menus", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "ArrowDown", metaKey: true },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 0,
      }),
    ).toBeNull();

    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "ArrowDown" },
        isVisible: false,
        filteredCompletions: completions,
        selectedIndex: 0,
      }),
    ).toBeNull();
  });
});
