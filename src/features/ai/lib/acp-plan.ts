import type { AcpPlanEntry } from "../types/acp.types";

const PRIORITIES = new Set(["high", "medium", "low"]);
const STATUSES = new Set(["pending", "in_progress", "completed"]);

function isPlanEntry(value: unknown): value is AcpPlanEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.content === "string" &&
    PRIORITIES.has(entry.priority as string) &&
    STATUSES.has(entry.status as string)
  );
}

/** Reads a plan saved with a message, dropping anything that is not an ACP plan entry. */
export function deserializeAcpPlan(value?: string | null): AcpPlanEntry[] | undefined {
  if (!value) return undefined;
  try {
    const entries: unknown = JSON.parse(value);
    if (!Array.isArray(entries)) return undefined;
    const plan = entries.filter(isPlanEntry);
    return plan.length > 0 ? plan : undefined;
  } catch {
    return undefined;
  }
}
