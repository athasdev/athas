import { getContextUsagePercent, getContextUsageTone } from "@/features/ai/lib/acp-usage";
import { getComposerBudgetTone } from "@/features/ai/lib/composer-context-budget";
import type { AcpCost, AcpUsageUpdate } from "@/features/ai/types/acp.types";
import type { ContextBudget } from "@/features/ai/types/context-budget.types";

export interface SessionContextUsage {
  usedTokens: number;
  /** The context window, when the agent or the model says how large it is. */
  limitTokens: number | null;
  /** Share of the window in use, 0 to 100, or null without a known window. */
  percent: number | null;
  tone: "accent" | "warning" | "error";
  cost: AcpCost | null;
}

/** An ACP agent's own report of its context window, once it sent one. */
export function getAcpContextUsage(usage: AcpUsageUpdate | null): SessionContextUsage | null {
  if (!usage || usage.size <= 0) return null;
  return {
    usedTokens: usage.used,
    limitTokens: usage.size,
    percent: getContextUsagePercent(usage),
    tone: getContextUsageTone(usage),
    cost: usage.cost ?? null,
  };
}

/** What the built-in agent's next request would carry from this session, before anything is typed. */
export function getBudgetContextUsage(budget: ContextBudget | null): SessionContextUsage | null {
  if (!budget || budget.usedTokens <= 0) return null;
  const hasConversation = budget.items.some((item) => item.kind === "history" && item.tokens > 0);
  if (!hasConversation) return null;
  return {
    usedTokens: budget.usedTokens,
    limitTokens: budget.limitTokens,
    percent:
      budget.ratio === null ? null : budget.overLimit ? 100 : Math.min(100, budget.ratio * 100),
    tone: getComposerBudgetTone(budget),
    cost: null,
  };
}
