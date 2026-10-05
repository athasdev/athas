import type { DiagnosticCodeAction } from "@/features/diagnostics/types/diagnostics.types";

export interface CodeActionGroup {
  id: string;
  label: string;
  actions: DiagnosticCodeAction[];
}

const GROUPS = [
  { id: "quickfix", label: "Quick Fix" },
  { id: "refactor", label: "Refactor" },
  { id: "source", label: "Source Action" },
] as const;

function groupId(kind: string | undefined): string {
  if (!kind) return "quickfix";
  return (
    GROUPS.find((group) => kind === group.id || kind.startsWith(`${group.id}.`))?.id ?? "other"
  );
}

/**
 * Enabled code actions in the lightbulb menu's order: quick fixes, refactors, source actions,
 * then anything else, with the server's preferred actions first in each group.
 */
export function groupCodeActions(actions: readonly DiagnosticCodeAction[]): CodeActionGroup[] {
  const enabled = actions.filter((action) => !action.disabledReason);
  const groups = [...GROUPS, { id: "other", label: "More Actions" }].map((group) => ({
    id: group.id,
    label: group.label,
    actions: enabled
      .filter((action) => groupId(action.kind) === group.id)
      .sort((a, b) => Number(b.isPreferred) - Number(a.isPreferred)),
  }));
  return groups.filter((group) => group.actions.length > 0);
}
