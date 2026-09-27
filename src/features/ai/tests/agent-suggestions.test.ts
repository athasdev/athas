import { describe, expect, it } from "vite-plus/test";
import { buildAgentSuggestions } from "@/features/ai/lib/agent-suggestions";

const skill = (id: string, updatedAt: string) => ({
  id,
  title: `Skill ${id}`,
  content: `Do ${id}`,
  createdAt: updatedAt,
  updatedAt,
});

describe("Agent suggestions", () => {
  it("leads with what the workspace needs: changes, problems and the open file", () => {
    const suggestions = buildAgentSuggestions({
      changedFileCount: 3,
      problemCount: 1,
      activeFile: { name: "app.ts", relativePath: "src/app.ts" },
      skills: [skill("a", "2026-01-01")],
    });
    expect(suggestions.map((suggestion) => suggestion.title)).toEqual([
      "Review my changes (3 files)",
      "Fix 1 problem",
      "Explain app.ts",
      "Skill a",
    ]);
    expect(suggestions[2].content).toContain("src/app.ts");
  });

  it("falls back to the newest skills and general prompts in a clean workspace", () => {
    const suggestions = buildAgentSuggestions({
      changedFileCount: 0,
      problemCount: 0,
      activeFile: null,
      skills: [skill("old", "2026-01-01"), skill("new", "2026-03-01")],
    });
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      "new",
      "old",
      "builtin-plan-implementation",
      "builtin-find-fix-bug",
    ]);
  });
});
