import { ListChecksIcon as ListChecks, PlayIcon as Play } from "@/ui/icons";
import { memo, useCallback, useState } from "react";
import type { ParsedPlan, PlanStep } from "@/features/ai/lib/plan-parser";
import { Button } from "@/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/ui/card";
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

      <Card className="my-2 border-primary/20 bg-primary/5" size="sm">
        <CardHeader className="flex flex-row items-center gap-1.5">
          <ListChecks className="text-primary" />
          <CardTitle className="text-primary">
            Plan ({plan.steps.length} {plan.steps.length === 1 ? "step" : "steps"})
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-1.5">
          {plan.steps.map((step) => (
            <PlanStepDisplay key={step.index} step={step} status={getStepStatus(step.index)} />
          ))}
        </CardContent>

        {!isStreaming && onExecuteStep && (
          <CardFooter className="border-primary/20 bg-transparent">
            <Button type="button" variant="accent" onClick={handleExecutePlan} size="xs">
              <Play />
              Execute Plan
            </Button>
          </CardFooter>
        )}
      </Card>

      {plan.afterPlan && (
        <div className="mt-2">
          <MarkdownRenderer content={plan.afterPlan} />
        </div>
      )}
    </div>
  );
});
