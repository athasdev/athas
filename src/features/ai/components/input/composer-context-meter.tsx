import {
  getComposerBudgetTone,
  groupComposerBudget,
} from "@/features/ai/lib/composer-context-budget";
import { formatTokenCount } from "@/features/ai/lib/acp-usage";
import type { ContextBudget } from "@/features/ai/types/context-budget.types";
import { Button } from "@/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { ProgressCircle } from "@/ui/progress";

function describeBudget(budget: ContextBudget) {
  const used = `${formatTokenCount(budget.usedTokens)} tokens`;
  if (budget.limitTokens === null) return `${used} of context`;
  const percent = Math.round((budget.ratio ?? 0) * 100);
  return `${percent}% of ${formatTokenCount(budget.limitTokens)} context (${used})`;
}

/**
 * How much of the built-in agent's context the next request would use, with a hover breakdown
 * of where it goes. It warns before the history has to be summarised or trimmed.
 */
export function ComposerContextMeter({ budget }: { budget: ContextBudget }) {
  if (budget.usedTokens <= 0) return null;

  const tone = getComposerBudgetTone(budget);
  const description = describeBudget(budget);
  const groups = groupComposerBudget(budget);

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={200}
        closeDelay={120}
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tone={tone === "accent" ? "default" : tone === "warning" ? "warning" : "danger"}
            aria-label={`Context window: ${description}`}
          />
        }
      >
        <ProgressCircle value={budget.overLimit ? 100 : (budget.ratio ?? 0) * 100} tone={tone} />
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" size="default">
        <div className="flex flex-col gap-2 ui-text-sm">
          <div className="font-medium text-foreground">{description}</div>
          <ul className="flex flex-col gap-1" aria-label="Context breakdown">
            {groups.map((group) => (
              <li key={group.id} className="flex items-center gap-2 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {group.label}
                  {group.count > 1 ? ` (${group.count})` : ""}
                  {group.truncated ? " · trimmed" : ""}
                </span>
                <span className="shrink-0 tabular-nums">{formatTokenCount(group.tokens)}</span>
              </li>
            ))}
          </ul>
          {tone !== "accent" ? (
            <p className="text-subtle-foreground">
              {budget.overLimit
                ? "Over the limit: older messages will be summarised and large files cut."
                : "Nearly full: run /compact or start a new chat to keep answers sharp."}
            </p>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
