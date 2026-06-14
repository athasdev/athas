import { describe, expect, it } from "vite-plus/test";
import { resolveLspCompletionKeyAction } from "@/features/athas-editor/utils/lsp-completion-keys";
import type { FilteredCompletion } from "@/utils/fuzzy-matcher";

const completions: FilteredCompletion[] = [
  {
    item: { label: "alpha" },
    score: 1,
    indices: [],
  },
];

describe("Athas editor lsp completion key resolution", () => {
  it("leaves Shift+Tab available for outdent while completions are visible", () => {
    expect(
      resolveLspCompletionKeyAction({
        keyState: { key: "Tab", shiftKey: true },
        isVisible: true,
        filteredCompletions: completions,
        selectedIndex: 0,
      }),
    ).toBeNull();
  });
});
