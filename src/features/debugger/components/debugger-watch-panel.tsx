import { ArrowsClockwise, Plus, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendDebugAdapterRequest } from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger-store";
import type { DebugRequestContext } from "../types/debugger";
import { Button } from "@/ui/button";
import Input from "@/ui/input";

interface DebugWatchPanelProps {
  activeSessionId?: string;
  selectedFrameId: number | null;
  isPaused: boolean;
  pendingRequests: Record<number, DebugRequestContext>;
}

export function DebugWatchPanel({
  activeSessionId,
  selectedFrameId,
  isPaused,
  pendingRequests,
}: DebugWatchPanelProps) {
  const watchExpressions = useDebuggerStore.use.watchExpressions();
  const watchResults = useDebuggerStore.use.watchResults();
  const debuggerActions = useDebuggerStore.use.actions();
  const [newExpression, setNewExpression] = useState("");

  const pendingExpressionIds = useMemo(
    () =>
      new Set(
        Object.values(pendingRequests)
          .filter((request) => request.command === "evaluate")
          .map((request) => request.expressionId),
      ),
    [pendingRequests],
  );

  const evaluateExpression = useCallback(
    async (expressionId: string, expression: string) => {
      if (!activeSessionId || !isPaused) return;

      try {
        const seq = await sendDebugAdapterRequest(activeSessionId, "evaluate", {
          expression,
          frameId: selectedFrameId ?? undefined,
          context: "watch",
        });
        debuggerActions.registerAdapterRequest(seq, { command: "evaluate", expressionId });
      } catch (error) {
        debuggerActions.setWatchResult({
          expressionId,
          value: "",
          variablesReference: 0,
          error: error instanceof Error ? error.message : String(error),
          evaluatedAt: Date.now(),
        });
      }
    },
    [activeSessionId, debuggerActions, isPaused, selectedFrameId],
  );

  const evaluateAll = useCallback(() => {
    if (!activeSessionId || !isPaused) return;

    for (const watchExpression of watchExpressions) {
      void evaluateExpression(watchExpression.id, watchExpression.expression);
    }
  }, [activeSessionId, evaluateExpression, isPaused, watchExpressions]);

  useEffect(() => {
    evaluateAll();
  }, [evaluateAll, selectedFrameId]);

  const addExpression = () => {
    const watchExpression = debuggerActions.addWatchExpression(newExpression);
    if (!watchExpression) return;

    setNewExpression("");
    void evaluateExpression(watchExpression.id, watchExpression.expression);
  };

  return (
    <div className="space-y-1.5 p-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={newExpression}
          onChange={(event) => setNewExpression(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addExpression();
            }
          }}
          placeholder="Add expression"
          size="xs"
        />
        <Button
          size="icon-sm"
          variant="secondary"
          tooltip="Add watch"
          disabled={!newExpression.trim()}
          onClick={addExpression}
        >
          <Plus />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          tooltip="Refresh watches"
          disabled={!activeSessionId || !isPaused || watchExpressions.length === 0}
          onClick={evaluateAll}
        >
          <ArrowsClockwise />
        </Button>
      </div>

      {watchExpressions.length === 0 ? (
        <div className="px-1 py-3 text-center text-text-lighter text-xs">
          Add expressions to inspect while paused.
        </div>
      ) : (
        <div className="space-y-1">
          {watchExpressions.map((watchExpression) => {
            const result = watchResults[watchExpression.id];
            const isPending = pendingExpressionIds.has(watchExpression.id);

            return (
              <div
                key={watchExpression.id}
                className="group rounded-md border border-border/60 bg-secondary-bg/40 px-2 py-1.5"
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-text"
                    onClick={() =>
                      void evaluateExpression(watchExpression.id, watchExpression.expression)
                    }
                  >
                    {watchExpression.expression}
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100"
                    tooltip="Remove watch"
                    onClick={() => debuggerActions.removeWatchExpression(watchExpression.id)}
                  >
                    <Trash />
                  </Button>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-text-lighter">
                  {isPending
                    ? "Evaluating..."
                    : result?.error
                      ? result.error
                      : result?.value || "Not evaluated"}
                  {result?.type && !result.error ? (
                    <span className="ml-1 text-text-lighter/70">({result.type})</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
