import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Key, Terminal } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { AgentConfig } from "@/features/ai/types/acp";
import {
  AI_AGENTS,
  getAgentById,
  getAvailableProviders,
  getModelById,
  isAgentProvider,
  updateAgentStatus,
} from "@/features/ai/types/providers";
import { cn } from "@/utils/cn";

interface ModelProviderSelectorProps {
  currentProviderId: string;
  currentModelId: string;
  onProviderChange: (providerId: string, modelId: string) => void;
  onApiKeyRequest: (providerId: string) => void;
  hasApiKey: (providerId: string) => boolean;
}

const ModelProviderSelector = ({
  currentProviderId,
  currentModelId,
  onProviderChange,
  onApiKeyRequest,
  hasApiKey,
}: ModelProviderSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState(currentProviderId);
  const [agents, setAgents] = useState(AI_AGENTS);

  // Detect installed agents on mount
  useEffect(() => {
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        // Update the global AI_AGENTS with installation status
        updateAgentStatus(availableAgents.map((a) => ({ id: a.id, installed: a.installed })));
        // Update local state
        setAgents([...AI_AGENTS]);
      } catch (error) {
        console.error("Failed to detect agents:", error);
      }
    };
    detectAgents();
  }, []);

  // Get current display name
  const getCurrentDisplayName = (): string => {
    if (isAgentProvider(currentProviderId)) {
      const agent = getAgentById(currentProviderId);
      return agent?.name || "Select Model";
    }
    const model = getModelById(currentProviderId, currentModelId);
    return model?.name || "Select Model";
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
  };

  const handleModelSelectAndClose = (providerId: string, modelId: string) => {
    onProviderChange(providerId, modelId);
    setIsOpen(false);
  };

  const handleModelSelect = (modelId: string) => {
    handleModelSelectAndClose(selectedProviderId, modelId);
  };

  const handleApiKeyClick = (e: React.MouseEvent, providerId: string) => {
    e.stopPropagation();
    onApiKeyRequest(providerId);
    isOpen && setIsOpen(false);
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
    return tokens.toString();
  };

  // Handle agent selection
  const handleAgentSelect = (agentId: string) => {
    // For agents, we use the agent ID as both provider and model ID
    onProviderChange(agentId, agentId);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Current Selection Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="ui-font flex min-w-40 items-center gap-1.5 rounded bg-transparent px-2 py-1 text-xs transition-colors hover:bg-hover"
      >
        {isAgentProvider(currentProviderId) && (
          <Terminal size={10} className="shrink-0 text-blue-400" />
        )}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-text text-xs">{getCurrentDisplayName()}</div>
        </div>
        <ChevronDown
          size={10}
          className={cn(
            "text-text-lighter transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="-translate-x-1/2 -translate-y-1/2 fixed top-1/2 left-1/2 z-9999 max-h-[80vh] min-w-[480px] transform overflow-y-auto rounded-lg border border-border bg-primary-bg shadow-xl">
          {/* CLI Agents Section */}
          <div className="border-border border-b">
            <div className="bg-secondary-bg px-3 py-1.5">
              <div className="flex items-center gap-2 font-medium text-text-lighter text-xs">
                <Terminal size={10} />
                CLI Agents
              </div>
            </div>
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors",
                  !agent.installed && "cursor-not-allowed opacity-50",
                  currentProviderId === agent.id
                    ? "border-blue-500/20 bg-blue-500/10"
                    : agent.installed && "hover:bg-hover",
                )}
                onClick={() => agent.installed && handleAgentSelect(agent.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-text text-xs">{agent.name}</div>
                    {currentProviderId === agent.id && (
                      <Check size={10} className="text-blue-400" />
                    )}
                  </div>
                  <div className="text-text-lighter text-xs">{agent.description}</div>
                </div>
                {agent.installed ? (
                  <div className="flex items-center gap-1 rounded border border-green-500/30 bg-green-500/20 px-2 py-1 text-green-400 text-xs">
                    Installed
                  </div>
                ) : (
                  <div className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-2 py-1 text-text-lighter text-xs">
                    Not Installed
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* API Providers Section */}
          <div className="bg-secondary-bg px-3 py-1.5">
            <div className="font-medium text-text-lighter text-xs">API Providers</div>
          </div>
          {getAvailableProviders().map((provider) => (
            <div key={provider.id} className="border-border border-b last:border-b-0">
              {/* Provider Header */}
              <div
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors",
                  selectedProviderId === provider.id
                    ? "border-blue-500/20 bg-blue-500/10"
                    : "hover:bg-hover",
                )}
                onClick={() => handleProviderSelect(provider.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-text text-xs">{provider.name}</div>
                    {selectedProviderId === provider.id && (
                      <Check size={10} className="text-blue-400" />
                    )}
                  </div>
                </div>

                {/* API Key Status */}
                {provider.requiresApiKey ? (
                  <button
                    onClick={(e) => handleApiKeyClick(e, provider.id)}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                      hasApiKey(provider.id)
                        ? "border border-border bg-secondary-bg text-text-lighter hover:bg-hover"
                        : "border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30",
                    )}
                  >
                    <Key size={10} />
                    {hasApiKey(provider.id) ? "Key Set" : "Set Key"}
                  </button>
                ) : (
                  <div className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/20 px-2 py-1 text-blue-400 text-xs">
                    ✓ Ready
                  </div>
                )}
              </div>

              {/* Models List */}
              {selectedProviderId === provider.id && (
                <div className="border-border border-t bg-secondary-bg">
                  {provider.models.map((model) => (
                    <div
                      key={model.id}
                      className={cn(
                        "relative flex cursor-pointer items-center gap-2 px-4 py-1.5 transition-colors",
                        currentModelId === model.id && currentProviderId === provider.id
                          ? "border-blue-500/30 bg-blue-500/20"
                          : "hover:bg-hover",
                      )}
                      onClick={() => handleModelSelect(model.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium text-text text-xs">{model.name}</div>
                          {currentModelId === model.id && currentProviderId === provider.id && (
                            <Check size={8} className="shrink-0 text-blue-400" />
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-text-lighter text-xs">
                        <span>{formatTokens(model.maxTokens)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Click Outside to Close */}
      {isOpen && (
        <div className="fixed inset-0 z-9998 bg-black/20" onClick={() => setIsOpen(false)} />
      )}
    </div>
  );
};

export default ModelProviderSelector;
