import { ListChecksIcon as ListChecks, PlayIcon as Play } from "@/ui/icons";
import { memo, useCallback, useState } from "react";
import type { ParsedPlan, PlanStep } from "@/features/ai/lib/plan-parser";
import { Button } from "@/ui/button";
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

      <div className="my-2 rounded-2xl border border-primary/20 bg-primary/5">
        <div className="flex items-center gap-1.5 border-primary/20 border-b px-3 py-2">
          <ListChecks className="text-primary" />
          <span className="font-medium text-primary ui-text-sm">
            Plan ({plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"})
          </span>
        </div>

        <div className="space-y-1.5 p-3">
          {plan.steps.map((step) => (
            <PlanStepDisplay key={step.index} step={step} status={getStepStatus(step.index)} />
          ))}
        </div>

        {!isStreaming && onExecuteStep && (
          <div className="border-primary/20 border-t px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleExecutePlan}
              className={cn(
                "gap-1.5 rounded-full border border-primary/30",
                "bg-primary/20 text-primary hover:bg-primary/30",
              )}
              size="xs"
            >
              <Play />
              Execute Plan
            </Button>
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
