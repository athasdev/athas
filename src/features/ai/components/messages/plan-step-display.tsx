import {
  CheckCircleIcon as CheckCircle2,
  CaretRightIcon as ChevronRight,
  CircleIcon as Circle,
  PlayIcon as Play,
} from "@/ui/icons";
import { memo, useState } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import MarkdownRenderer from "./markdown-renderer";

interface PlanStepDisplayProps {
  step: PlanStep;
  status: "pending" | "current" | "completed";
}

export const PlanStepDisplay = memo(function PlanStepDisplay({
  step,
  status,
}: PlanStepDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const StatusIcon = status === "completed" ? CheckCircle2 : status === "current" ? Play : Circle;

  const statusColor =
    status === "completed"
      ? "text-success"
      : status === "current"
        ? "text-primary"
        : "text-subtle-foreground";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background/80",
        status === "current" && "border-primary/30 bg-primary/5",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => step.description && setIsExpanded(!isExpanded)}
        className="h-auto w-full justify-start gap-2 px-2.5 py-2 text-left"
      >
        <StatusIcon className={cn("shrink-0", statusColor)} />
        <span className="min-w-0 flex-1 font-medium text-foreground">
          {step.index + 1}. {step.title}
        </span>
        {step.description && (
          <ChevronRight
            className={cn(
              "shrink-0 text-subtle-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </Button>
      {isExpanded && step.description && (
        <div className="border-border border-t px-3 py-2.5 text-muted-foreground ui-text-sm">
          <MarkdownRenderer content={step.description} />
        </div>
      )}
    </div>
  );
});
