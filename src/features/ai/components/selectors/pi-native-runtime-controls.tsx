import { ChevronDown, Cpu, Zap } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useChatActions } from "@/features/ai/hooks/use-chat-store";
import {
  type HarnessRuntimeModelInfo,
  listHarnessRuntimeModels,
  listHarnessRuntimeThinkingLevels,
} from "@/features/ai/lib/harness-runtime";
import type { HarnessRuntimeBackend } from "@/features/ai/lib/harness-runtime-backend";
import type { AcpRuntimeState } from "@/features/ai/types/acp";
import type { AgentType, ChatScopeId } from "@/features/ai/types/ai-chat";
import { useToast } from "@/features/layout/contexts/toast-context";
import Dropdown from "@/ui/dropdown";

const ModelTrigger = React.forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    label: string;
    disabled?: boolean;
  }
>(({ onClick, onKeyDown, label, disabled }, ref) => (
  <button
    ref={ref}
    onClick={onClick}
    onKeyDown={onKeyDown}
    disabled={disabled}
    type="button"
    className="ui-font flex h-8 items-center gap-1.5 rounded-xl border border-transparent px-2.5 text-xs transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
  >
    <Cpu size={11} className="text-text-lighter" />
    <span className="max-w-[140px] truncate text-text">{label}</span>
    <ChevronDown size={12} className="text-text-lighter" />
  </button>
));
ModelTrigger.displayName = "ModelTrigger";

const ThinkingTrigger = React.forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
    label: string;
    disabled?: boolean;
  }
>(({ onClick, onKeyDown, label, disabled }, ref) => (
  <button
    ref={ref}
    onClick={onClick}
    onKeyDown={onKeyDown}
    disabled={disabled}
    type="button"
    className="ui-font flex h-8 items-center gap-1.5 rounded-xl border border-transparent px-2.5 text-xs transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
  >
    <Zap size={11} className="text-text-lighter" />
    <span className="max-w-[140px] truncate text-text">{label}</span>
    <ChevronDown size={12} className="text-text-lighter" />
  </button>
));
ThinkingTrigger.displayName = "ThinkingTrigger";

interface PiNativeRuntimeControlsProps {
  scopeId?: ChatScopeId;
  agentId: AgentType;
  runtimeBackend: HarnessRuntimeBackend;
  runtimeState: AcpRuntimeState | null;
  disabled?: boolean;
}

const encodeModelValue = (provider: string, modelId: string) => `${provider}::${modelId}`;

const decodeModelValue = (value: string) => {
  const separatorIndex = value.indexOf("::");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    provider: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 2),
  };
};

export function PiNativeRuntimeControls({
  scopeId,
  agentId,
  runtimeBackend,
  runtimeState,
  disabled = false,
}: PiNativeRuntimeControlsProps) {
  const chatActions = useChatActions(scopeId);
  const { showToast } = useToast();
  const [models, setModels] = useState<HarnessRuntimeModelInfo[]>([]);
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const isEnabled =
    runtimeBackend === "pi-native" &&
    agentId === "pi" &&
    runtimeState?.source === "pi-native" &&
    Boolean(runtimeState.sessionId || runtimeState.sessionPath);

  useEffect(() => {
    if (!isEnabled || !scopeId) {
      setModels([]);
      setThinkingLevels([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void Promise.all([
      listHarnessRuntimeModels(runtimeBackend, agentId, scopeId),
      listHarnessRuntimeThinkingLevels(runtimeBackend, agentId, scopeId),
    ])
      .then(([nextModels, nextThinkingLevels]) => {
        if (cancelled) {
          return;
        }

        setModels(nextModels);
        setThinkingLevels(nextThinkingLevels);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to load native Pi runtime controls:", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, isEnabled, runtimeBackend, scopeId]);

  const modelOptions = useMemo(() => {
    const options = models.map((model) => ({
      value: encodeModelValue(model.provider, model.modelId),
      label: model.name,
    }));

    if (runtimeState?.provider && runtimeState.modelId) {
      const currentValue = encodeModelValue(runtimeState.provider, runtimeState.modelId);
      if (!options.some((option) => option.value === currentValue)) {
        options.unshift({
          value: currentValue,
          label: runtimeState.modelId,
        });
      }
    }

    return options;
  }, [models, runtimeState?.modelId, runtimeState?.provider]);

  const thinkingOptions = useMemo(() => {
    const options = thinkingLevels.map((level) => ({
      value: level,
      label: level,
    }));

    if (
      runtimeState?.thinkingLevel &&
      !options.some((option) => option.value === runtimeState.thinkingLevel)
    ) {
      options.unshift({
        value: runtimeState.thinkingLevel,
        label: runtimeState.thinkingLevel,
      });
    }

    return options;
  }, [runtimeState?.thinkingLevel, thinkingLevels]);

  const modelValue =
    runtimeState?.provider && runtimeState.modelId
      ? encodeModelValue(runtimeState.provider, runtimeState.modelId)
      : "";

  const handleModelChange = async (value: string) => {
    const selection = decodeModelValue(value);
    if (!selection) {
      return;
    }

    try {
      await chatActions.changeSessionModel(selection);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "Failed to change Pi model",
        type: "error",
      });
    }
  };

  const handleThinkingChange = async (value: string) => {
    if (!value) {
      return;
    }

    try {
      await chatActions.changeSessionThinkingLevel(value);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "Failed to change Pi thinking level",
        type: "error",
      });
    }
  };

  if (!isEnabled || (modelOptions.length === 0 && thinkingOptions.length === 0)) {
    return null;
  }

  return (
    <>
      {modelOptions.length > 0 ? (
        <Dropdown
          value={modelValue}
          options={modelOptions}
          onChange={(value) => void handleModelChange(value)}
          searchable={true}
          className="w-auto"
          CustomTrigger={React.forwardRef<
            HTMLButtonElement,
            {
              onClick?: () => void;
              onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
            }
          >((props, ref) => {
            const selectedOption = modelOptions.find((o) => o.value === modelValue);
            return (
              <ModelTrigger
                ref={ref}
                onClick={props.onClick}
                onKeyDown={props.onKeyDown}
                label={selectedOption?.label || "Model"}
                disabled={disabled || loading}
              />
            );
          })}
        />
      ) : null}
      {thinkingOptions.length > 0 ? (
        <Dropdown
          value={runtimeState?.thinkingLevel ?? ""}
          options={thinkingOptions}
          onChange={(value) => void handleThinkingChange(value)}
          className="w-auto"
          CustomTrigger={React.forwardRef<
            HTMLButtonElement,
            {
              onClick?: () => void;
              onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
            }
          >((props, ref) => {
            const selectedOption = thinkingOptions.find(
              (o) => o.value === (runtimeState?.thinkingLevel ?? ""),
            );
            return (
              <ThinkingTrigger
                ref={ref}
                onClick={props.onClick}
                onKeyDown={props.onKeyDown}
                label={selectedOption?.label || "Thinking"}
                disabled={disabled || loading}
              />
            );
          })}
        />
      ) : null}
    </>
  );
}
