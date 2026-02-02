import { ListChecks, Play } from "lucide-react";
import { memo, useCallback, useState } from "react";
import type { ParsedPlan, PlanStep } from "@/features/ai/lib/plan-parser";
import { cn } from "@/utils/cn";
import MarkdownRenderer from "./markdown-renderer";
import { PlanStepDisplay } from "./plan-step-display";

interface PlanBlockDisplayProps {
  plan: ParsedPlan;
  isStreaming?: boolean;
  onExecuteStep?: (step: PlanStep, stepIndex: number) => void;
}

export const PlanBlockDisplay = memo(function PlanBlockDisplay({
  plan,
  isStreaming,
  onExecuteStep,
}: PlanBlockDisplayProps) {
  const [executingStepIndex, setExecutingStepIndex] = useState(-1);

  const handleExecutePlan = useCallback(() => {
    if (plan.steps.length > 0 && onExecuteStep) {
      setExecutingStepIndex(0);
      onExecuteStep(plan.steps[0], 0);
    }
  }, [plan.steps, onExecuteStep]);

  const getStepStatus = (index: number): "pending" | "current" | "completed" => {
    if (index === executingStepIndex) return "current";
    return "pending";
  };

  return (
    <div>
      {plan.beforePlan && (
        <div className="mb-2">
          <MarkdownRenderer content={plan.beforePlan} />
        </div>
      )}

      <div className="my-2 rounded border border-accent/20 bg-accent/5">
        <div className="flex items-center gap-1.5 border-accent/20 border-b px-2 py-1.5">
          <ListChecks size={12} className="text-accent" />
          <span className="font-medium text-accent text-xs">
            Plan ({plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"})
          </span>
        </div>

        <div className="space-y-1 p-2">
          {plan.steps.map((step) => (
            <PlanStepDisplay key={step.index} step={step} status={getStepStatus(step.index)} />
          ))}
        </div>

        {!isStreaming && onExecuteStep && (
          <div className="border-accent/20 border-t px-2 py-1.5">
            <button
              type="button"
              onClick={handleExecutePlan}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1 text-xs transition-colors",
                "bg-accent/20 text-accent hover:bg-accent/30",
              )}
            >
              <Play size={10} />
              Execute Plan
            </button>
          </div>
        )}
      </div>

      {plan.afterPlan && (
        <div className="mt-2">
          <MarkdownRenderer content={plan.afterPlan} />
        </div>
      )}
    </div>
  );
});
