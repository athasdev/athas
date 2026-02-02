import { CheckCircle2, ChevronRight, Circle, Play } from "lucide-react";
import { memo, useState } from "react";
import type { PlanStep } from "@/features/ai/lib/plan-parser";
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
        "rounded border border-border",
        status === "current" && "border-accent/30 bg-accent/5",
      )}
    >
      <button
        type="button"
        onClick={() => step.description && setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-hover"
      >
        <StatusIcon size={12} className={cn("shrink-0", statusColor)} />
        <span className="min-w-0 flex-1 font-medium text-text">
          {step.index + 1}. {step.title}
        </span>
        {step.description && (
          <ChevronRight
            size={10}
            className={cn(
              "shrink-0 text-text-lighter transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </button>
      {isExpanded && step.description && (
        <div className="border-border border-t px-3 py-2 text-text-light text-xs">
          <MarkdownRenderer content={step.description} />
        </div>
      )}
    </div>
  );
});
