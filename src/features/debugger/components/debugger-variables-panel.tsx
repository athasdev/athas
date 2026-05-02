import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { sendDebugAdapterRequest } from "../services/debug-adapter-service";
import { useDebuggerStore } from "../stores/debugger-store";
import type { DebugRequestContext, DebugScope, DebugVariable } from "../types/debugger";
import { DebugEmptyState, EMPTY_DEBUG_SECTION_MESSAGES } from "./debugger-panels";

interface DebugVariablesPanelProps {
  activeSessionId?: string;
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  pendingRequests: Record<number, DebugRequestContext>;
}

export function DebugVariablesPanel({
  activeSessionId,
  selectedFrameId,
  scopes,
  variablesByReference,
  pendingRequests,
}: DebugVariablesPanelProps) {
  const debuggerActions = useDebuggerStore.use.actions();
  const [expandedVariableReferences, setExpandedVariableReferences] = useState<Set<number>>(
    () => new Set(),
  );

  useEffect(() => {
    setExpandedVariableReferences(new Set());
  }, [activeSessionId, selectedFrameId]);

  const isVariableReferencePending = (variablesReference: number) =>
    Object.values(pendingRequests).some(
      (request) =>
        request.command === "variables" && request.variablesReference === variablesReference,
    );

  const toggleVariableExpansion = async (variablesReference: number) => {
    if (!activeSessionId || variablesReference <= 0) return;

    const shouldLoadChildren =
      !expandedVariableReferences.has(variablesReference) &&
      !variablesByReference[variablesReference];

    setExpandedVariableReferences((current) => {
      const next = new Set(current);
      if (next.has(variablesReference)) next.delete(variablesReference);
      else next.add(variablesReference);
      return next;
    });

    if (!shouldLoadChildren) return;

    try {
      const seq = await sendDebugAdapterRequest(activeSessionId, "variables", {
        variablesReference,
      });
      debuggerActions.registerAdapterRequest(seq, { command: "variables", variablesReference });
    } catch {
      setExpandedVariableReferences((current) => {
        const next = new Set(current);
        next.delete(variablesReference);
        return next;
      });
    }
  };

  const renderVariables = (variables: DebugVariable[], parentReference: number, depth = 0) =>
    variables.map((variable, index) => {
      const canExpand = variable.variablesReference > 0;
      const isExpanded = expandedVariableReferences.has(variable.variablesReference);
      const childVariables = variablesByReference[variable.variablesReference] ?? [];
      const isLoading = isVariableReferencePending(variable.variablesReference);

      return (
        <div key={`${parentReference}-${variable.name}-${index}`}>
          <div
            className="grid grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] gap-2 py-1 pr-3 text-[11px]"
            style={{ paddingLeft: 18 + depth * 12 }}
          >
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-1 text-left text-text-lighter",
                canExpand && "hover:text-text",
              )}
              disabled={!canExpand}
              onClick={() => void toggleVariableExpansion(variable.variablesReference)}
            >
              <CaretRight
                size={10}
                className={cn(
                  "shrink-0 transition-transform",
                  isExpanded && "rotate-90",
                  !canExpand && "opacity-0",
                )}
              />
              <span className="truncate">{variable.name}</span>
            </button>
            <span className="truncate font-mono text-text">
              {isLoading ? "Loading..." : variable.value || variable.type || ""}
            </span>
          </div>
          {isExpanded && childVariables.length > 0
            ? renderVariables(childVariables, variable.variablesReference, depth + 1)
            : null}
        </div>
      );
    });

  if (scopes.length === 0) {
    return <DebugEmptyState>{EMPTY_DEBUG_SECTION_MESSAGES.variables}</DebugEmptyState>;
  }

  return (
    <div className="py-1">
      {scopes.map((scope) => {
        const variables = variablesByReference[scope.variablesReference] ?? [];
        return (
          <div key={`${scope.name}-${scope.variablesReference}`}>
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="font-medium text-text">{scope.name}</span>
              <span className="text-[10px] text-text-lighter">{variables.length}</span>
            </div>
            {variables.length === 0 ? (
              <div className="px-6 pb-1.5 text-[11px] text-text-lighter">Empty</div>
            ) : (
              renderVariables(variables, scope.variablesReference)
            )}
          </div>
        );
      })}
    </div>
  );
}
