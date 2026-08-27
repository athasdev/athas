import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";

interface ChatPreferencesModelOptions {
  currentAgentId: AgentType;
  canChangeAgent: boolean;
  sessionConfigOptions: SessionConfigOption[];
}

export function getChatPreferencesModel({
  currentAgentId,
  canChangeAgent,
  sessionConfigOptions,
}: ChatPreferencesModelOptions) {
  const isCustomAgent = currentAgentId === "custom";
  const acpConfigOptions = isCustomAgent
    ? []
    : sessionConfigOptions
        .map((option) => ({
          option,
          category: classifySessionConfigOption(option),
        }))
        .filter(({ option }) => option.kind.type === "boolean" || option.kind.options.length > 0);
  const hasAcpConfigModeOption = acpConfigOptions.some(({ category }) => category === "mode");

  return {
    isCustomAgent,
    showAgentPreference: canChangeAgent,
    showAthasAgentPreferences: isCustomAgent,
    showModePreference: isCustomAgent || !hasAcpConfigModeOption,
    acpConfigOptions: acpConfigOptions.map(({ option }) => option),
  };
}
