import {
  BookOpenIcon as BookOpen,
  MagnifyingGlassIcon as Search,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
} from "@/ui/icons";
import { useMemo } from "react";
import { dispatchAIChatSkillInsert } from "@/features/ai/lib/skill-events";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

const shortcutIcons = [Sparkles, Search, Terminal, BookOpen];
const shortcutIconClassNames = ["text-accent", "text-success", "text-warning", "text-error"];
const builtinShortcuts: AIChatSkill[] = [
  {
    id: "builtin-plan-implementation",
    title: "Plan an implementation",
    content: "Inspect the relevant code and propose a focused implementation plan for this task:",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "builtin-find-fix-bug",
    title: "Find and fix a bug",
    content: "Investigate this bug, identify the root cause, implement the fix, and verify it:",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "builtin-write-tests",
    title: "Write tests for a change",
    content: "Inspect the relevant behavior and add focused tests for this change:",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "builtin-review-changes",
    title: "Review current changes",
    content: "Review the current workspace changes for bugs, regressions, and missing tests:",
    createdAt: "",
    updatedAt: "",
  },
];

export function AgentShortcuts({ className }: { className?: string }) {
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const visibleSkills = useMemo(
    () =>
      [
        ...[...skills].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
        ...builtinShortcuts,
      ].slice(0, 4),
    [skills],
  );

  return (
    <section className={cn("flex w-full flex-col gap-0.5", className)} aria-label="Suggestions">
      {visibleSkills.map((skill, index) => {
        const Icon = shortcutIcons[index % shortcutIcons.length];

        return (
          <Button
            key={skill.id}
            type="button"
            variant="ghost"
            size="lg"
            className="w-full justify-start overflow-hidden"
            onClick={() => dispatchAIChatSkillInsert(skill)}
          >
            <Icon className={shortcutIconClassNames[index % shortcutIconClassNames.length]} />
            <span className="min-w-0 truncate">{skill.title}</span>
          </Button>
        );
      })}
    </section>
  );
}
