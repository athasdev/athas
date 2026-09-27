import type { AgentSuggestion } from "@/features/ai/types/agent-suggestion.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";

const MAX_SUGGESTIONS = 4;

const STATIC_SUGGESTIONS: AgentSuggestion[] = [
  {
    id: "builtin-plan-implementation",
    kind: "prompt",
    title: "Plan an implementation",
    content: "Inspect the relevant code and propose a focused implementation plan for this task:",
  },
  {
    id: "builtin-find-fix-bug",
    kind: "prompt",
    title: "Find and fix a bug",
    content: "Investigate this bug, identify the root cause, implement the fix, and verify it:",
  },
  {
    id: "builtin-write-tests",
    kind: "prompt",
    title: "Write tests for a change",
    content: "Inspect the relevant behavior and add focused tests for this change:",
  },
];

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The empty chat's suggestions: what the workspace needs right now first (uncommitted changes,
 * problems, the open file), then the user's newest skills, then general prompts.
 */
export function buildAgentSuggestions({
  changedFileCount,
  problemCount,
  activeFile,
  skills,
}: {
  changedFileCount: number;
  problemCount: number;
  activeFile: { name: string; relativePath: string } | null;
  skills: AIChatSkill[];
}): AgentSuggestion[] {
  const contextual: AgentSuggestion[] = [];
  if (changedFileCount > 0) {
    contextual.push({
      id: "context-review-changes",
      kind: "review",
      title: `Review my changes (${plural(changedFileCount, "file")})`,
      content:
        "Review my uncommitted changes for bugs, regressions and missing tests. Use the Git diff of the workspace:",
    });
  }
  if (problemCount > 0) {
    contextual.push({
      id: "context-fix-problems",
      kind: "problems",
      title: `Fix ${plural(problemCount, "problem")}`,
      content: `Fix the ${plural(problemCount, "error and warning")} currently reported in the Problems panel, then verify the fix:`,
    });
  }
  if (activeFile) {
    contextual.push({
      id: "context-explain-file",
      kind: "file",
      title: `Explain ${activeFile.name}`,
      content: `Explain how ${activeFile.relativePath} works, its main responsibilities and how it fits into the project:`,
    });
  }

  const recentSkills = [...skills]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map<AgentSuggestion>((skill) => ({
      id: skill.id,
      kind: "skill",
      title: skill.title,
      content: skill.content,
    }));

  return [...contextual, ...recentSkills, ...STATIC_SUGGESTIONS].slice(0, MAX_SUGGESTIONS);
}
