import { CheckCircle2, ChevronRight, Circle, Play } from "lucide-react";
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
      ? "text-green-400"
      : status === "current"
        ? "text-accent"
        : "text-text-lighter";

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-primary-bg/80",
        status === "current" && "border-accent/30 bg-accent/5",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => step.description && setIsExpanded(!isExpanded)}
        className="h-auto w-full justify-start gap-2 px-2.5 py-2 text-left"
      >
        <StatusIcon className={cn("shrink-0", statusColor)} />
        <span className="min-w-0 flex-1 font-medium text-text">
          {step.index + 1}. {step.title}
        </span>
        {step.description && (
          <ChevronRight
            className={cn(
              "shrink-0 text-text-lighter transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </Button>
      {isExpanded && step.description && (
        <div className="border-border border-t px-3 py-2.5 text-text-light text-xs">
          <MarkdownRenderer content={step.description} />
        </div>
      )}
    </div>
  );
});
