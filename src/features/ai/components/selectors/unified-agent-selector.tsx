import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Key, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useChatActions, useChatState } from "@/features/ai/hooks/use-chat-store";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig } from "@/features/ai/types/acp";
import {
  AGENT_OPTIONS,
  type AgentType,
  type AIChatSurface,
  type ChatScopeId,
} from "@/features/ai/types/ai-chat";
import { getAvailableProviders } from "@/features/ai/types/providers";
import { useSettingsStore } from "@/features/settings/store";
import { cn } from "@/utils/cn";
import { getProvider } from "@/utils/providers";

interface UnifiedAgentSelectorProps {
  surface?: AIChatSurface;
  scopeId?: ChatScopeId;
  variant?: "header" | "input";
  onOpenSettings?: () => void;
}

interface DropdownPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function UnifiedAgentSelector({
  scopeId,
  variant = "header",
  onOpenSettings,
}: UnifiedAgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [activeSection, setActiveSection] = useState<"agents" | "models">("agents");
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const { settings, updateSetting } = useSettingsStore();
  const chatState = useChatState(scopeId);
  const { dynamicModels, setDynamicModels } = useAIChatStore();
  const chatActions = useChatActions(scopeId);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentAgentId = useMemo(() => {
    const currentChat = chatState.chats.find((chat) => chat.id === chatState.currentChatId);
    return currentChat?.agentId ?? chatState.selectedAgentId;
  }, [chatState.chats, chatState.currentChatId, chatState.selectedAgentId]);
  const currentAgent = AGENT_OPTIONS.find((a) => a.id === currentAgentId);
  const isCustomAgent = currentAgentId === "custom";
  const providers = getAvailableProviders();

  // Get current model name for custom agent
  const currentModelName = useMemo(() => {
    if (!isCustomAgent) return null;
    const providerModels = dynamicModels[settings.aiProviderId];
    const dynamicModel = providerModels?.find((m) => m.id === settings.aiModelId);
    if (dynamicModel) return dynamicModel.name;
    const provider = providers.find((p) => p.id === settings.aiProviderId);
    const staticModel = provider?.models.find((m) => m.id === settings.aiModelId);
    return staticModel?.name || settings.aiModelId;
  }, [isCustomAgent, dynamicModels, settings.aiProviderId, settings.aiModelId, providers]);

  // Detect installed agents
  useEffect(() => {
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        const installed = new Set<string>(["custom"]);
        for (const agent of availableAgents) {
          if (agent.installed) {
            installed.add(agent.id);
          }
        }
        setInstalledAgents(installed);
      } catch {
        // Silent fail
      }
    };
    detectAgents();
  }, []);

  // Fetch dynamic models for providers
  useEffect(() => {
    const fetchModels = async () => {
      for (const provider of providers) {
        if (dynamicModels[provider.id]?.length > 0) continue;
        if (provider.requiresApiKey) continue;
        const providerInstance = getProvider(provider.id);
        if (providerInstance?.getModels) {
          try {
            const models = await providerInstance.getModels();
            if (models.length > 0) {
              setDynamicModels(provider.id, models);
            }
          } catch {
            // Silent fail
          }
        }
      }
    };
    fetchModels();
  }, [providers, dynamicModels, setDynamicModels]);

  // Build filtered items list
  const filteredItems = useMemo(() => {
    const items: Array<{
      type: "section" | "agent" | "provider" | "model";
      id: string;
      name: string;
      providerId?: string;
      isInstalled?: boolean;
      isCurrent?: boolean;
      requiresApiKey?: boolean;
      hasKey?: boolean;
    }> = [];

    const searchLower = search.toLowerCase();

    // Add agents section
    if (activeSection === "agents" || !search) {
      const matchingAgents = AGENT_OPTIONS.filter(
        (agent) =>
          !search ||
          agent.name.toLowerCase().includes(searchLower) ||
          agent.description.toLowerCase().includes(searchLower),
      );

      if (matchingAgents.length > 0) {
        items.push({ type: "section", id: "agents-section", name: "Agents" });
        for (const agent of matchingAgents) {
          items.push({
            type: "agent",
            id: agent.id,
            name: agent.name,
            isInstalled: installedAgents.has(agent.id),
            isCurrent: agent.id === currentAgentId,
          });
        }
      }
    }

    // Add models section (only for custom agent view or when searching)
    if ((activeSection === "models" || search) && isCustomAgent) {
      for (const provider of providers) {
        const providerHasKey = !provider.requiresApiKey || hasProviderApiKey(provider.id);
        const models = dynamicModels[provider.id] || provider.models;

        const matchingModels = models.filter(
          (model) =>
            !search ||
            provider.name.toLowerCase().includes(searchLower) ||
            model.name.toLowerCase().includes(searchLower) ||
            model.id.toLowerCase().includes(searchLower),
        );

        if (
          matchingModels.length > 0 ||
          (!search && provider.name.toLowerCase().includes(searchLower))
        ) {
          items.push({
            type: "provider",
            id: `provider-${provider.id}`,
            name: provider.name,
            providerId: provider.id,
            requiresApiKey: provider.requiresApiKey,
            hasKey: providerHasKey,
          });

          if (providerHasKey) {
            for (const model of matchingModels) {
              items.push({
                type: "model",
                id: model.id,
                name: model.name,
                providerId: provider.id,
                isCurrent: settings.aiProviderId === provider.id && settings.aiModelId === model.id,
              });
            }
          }
        }
      }
    }

    return items;
  }, [
    search,
    activeSection,
    installedAgents,
    currentAgentId,
    isCustomAgent,
    providers,
    dynamicModels,
    hasProviderApiKey,
    settings.aiProviderId,
    settings.aiModelId,
  ]);

  const selectableItems = useMemo(
    () => filteredItems.filter((item) => item.type === "agent" || item.type === "model"),
    [filteredItems],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search, activeSection]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setActiveSection("agents");
    }
  }, [isOpen]);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = 320;
    const estimatedHeight = 450;
    const safeWidth = Math.min(width, window.innerWidth - viewportPadding * 2);
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const openUp =
      variant !== "header" &&
      availableBelow < Math.min(estimatedHeight, 280) &&
      availableAbove > availableBelow;
    const maxHeight = Math.max(
      220,
      Math.min(estimatedHeight, openUp ? availableAbove - 6 : availableBelow - 6),
    );
    const measuredHeight = dropdownRef.current?.getBoundingClientRect().height ?? estimatedHeight;
    const visibleHeight = Math.min(maxHeight, measuredHeight);

    const desiredLeft = rect.right - safeWidth;
    const left = Math.max(
      viewportPadding,
      Math.min(desiredLeft, window.innerWidth - safeWidth - viewportPadding),
    );
    const top = openUp ? Math.max(viewportPadding, rect.top - visibleHeight - 6) : rect.bottom + 6;

    setPosition({ left, top, width: safeWidth, maxHeight });
  }, [variant]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
  }, [isOpen, updateDropdownPosition, search, filteredItems.length, activeSection]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    };

    const handleReposition = () => updateDropdownPosition();

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  const handleAgentChange = useCallback(
    async (agentId: AgentType) => {
      if (variant !== "header" && agentId === currentAgentId) {
        setIsOpen(false);
        return;
      }

      // In header variant, selecting Custom API should show models tab
      if (variant === "header" && agentId === "custom") {
        chatActions.setSelectedAgentId(agentId);
        setActiveSection("models");
        return;
      }

      setIsOpen(false);
      chatActions.setSelectedAgentId(agentId);

      const currentAgentInfo = AGENT_OPTIONS.find((a) => a.id === currentAgentId);
      if (currentAgentInfo?.isAcp) {
        try {
          await invoke("stop_acp_agent", { routeKey: scopeId ?? "panel" });
        } catch {
          // Silent fail
        }
      }

      if (variant === "header") {
        chatActions.createNewChat(agentId);
      } else {
        chatActions.changeCurrentChatAgent(agentId);
      }
    },
    [chatActions, currentAgentId, scopeId, variant],
  );

  const handleModelSelect = useCallback(
    (providerId: string, modelId: string) => {
      updateSetting("aiProviderId", providerId);
      updateSetting("aiModelId", modelId);
      setIsOpen(false);
      if (variant === "header") {
        chatActions.createNewChat();
      }
    },
    [chatActions, updateSetting, variant],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, selectableItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (selectableItems[selectedIndex]) {
            const item = selectableItems[selectedIndex];
            if (item.type === "agent") {
              handleAgentChange(item.id as AgentType);
            } else if (item.type === "model" && item.providerId) {
              handleModelSelect(item.providerId, item.id);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
        case "Tab":
          e.preventDefault();
          if (isCustomAgent) {
            setActiveSection((prev) => (prev === "agents" ? "models" : "agents"));
          }
          break;
      }
    },
    [isOpen, selectableItems, selectedIndex, handleAgentChange, handleModelSelect, isCustomAgent],
  );

  let selectableIndex = -1;

  return (
    <>
      {variant === "header" ? (
        <button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-8 items-center gap-1 rounded-full border border-border bg-primary-bg/80 pr-1.5 pl-2 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          aria-label="New chat"
        >
          <Plus size={14} />
          <ChevronDown size={10} className={cn("transition-transform", isOpen && "rotate-180")} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          className="ui-font flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary-bg/80 px-3 text-xs transition-colors hover:bg-hover"
        >
          <ProviderIcon providerId={currentAgentId} size={11} className="text-text-lighter" />
          <span className="max-w-[140px] truncate text-text">
            {currentAgent?.name || "Custom"}
            {isCustomAgent && currentModelName && (
              <span className="text-text-lighter"> / {currentModelName}</span>
            )}
          </span>
          <ChevronDown
            size={12}
            className={cn("text-text-lighter transition-transform", isOpen && "rotate-180")}
          />
        </button>
      )}

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            onKeyDown={handleKeyDown}
            className="fixed z-[10030] flex flex-col overflow-hidden rounded-2xl border border-border bg-primary-bg/95 shadow-xl backdrop-blur-sm"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
              maxHeight: `${position.maxHeight}px`,
            }}
          >
            {/* Search */}
            <div className="border-border/60 border-b p-2.5">
              <div className="relative">
                <Search
                  size={11}
                  className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 text-text-lighter"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search agents or models..."
                  className="w-full rounded-lg border border-border bg-secondary-bg py-1.5 pr-2 pl-7 text-text text-xs placeholder:text-text-lighter focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            {/* Section tabs (only for custom agent) */}
            {isCustomAgent && !search && (
              <div className="flex border-border/60 border-b px-2 py-1">
                <button
                  onClick={() => setActiveSection("agents")}
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1 text-xs transition-colors",
                    activeSection === "agents"
                      ? "bg-hover text-text"
                      : "text-text-lighter hover:text-text",
                  )}
                >
                  Agents
                </button>
                <button
                  onClick={() => setActiveSection("models")}
                  className={cn(
                    "flex-1 rounded-lg px-2 py-1 text-xs transition-colors",
                    activeSection === "models"
                      ? "bg-hover text-text"
                      : "text-text-lighter hover:text-text",
                  )}
                >
                  Models
                </button>
              </div>
            )}

            {/* Items */}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filteredItems.length === 0 ? (
                <div className="p-4 text-center text-text-lighter text-xs">No results found</div>
              ) : (
                filteredItems.map((item) => {
                  if (item.type === "section") {
                    return (
                      <div
                        key={item.id}
                        className="px-1 pt-2 pb-1 text-[10px] text-text-lighter uppercase tracking-wide"
                      >
                        {item.name}
                      </div>
                    );
                  }

                  if (item.type === "provider") {
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-1 pt-2 pb-1"
                      >
                        <span className="flex items-center gap-1.5 text-[10px] text-text-lighter uppercase tracking-wide">
                          <ProviderIcon
                            providerId={item.providerId || item.id}
                            size={10}
                            className="text-text-lighter"
                          />
                          {item.name}
                        </span>
                        {item.requiresApiKey && !item.hasKey && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenSettings?.();
                              setIsOpen(false);
                            }}
                            className="flex items-center gap-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] text-red-400 transition-colors hover:bg-red-500/25"
                          >
                            <Key size={7} />
                            Set Key
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (item.type === "agent") {
                    selectableIndex++;
                    const itemIndex = selectableIndex;
                    const isSelected = itemIndex === selectedIndex;

                    return (
                      <button
                        key={item.id}
                        onClick={() => handleAgentChange(item.id as AgentType)}
                        onMouseEnter={() => setSelectedIndex(itemIndex)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                          isSelected ? "bg-hover" : "bg-transparent",
                          item.isCurrent && "bg-accent/10",
                        )}
                      >
                        <ProviderIcon
                          providerId={item.id}
                          size={10}
                          className="text-text-lighter"
                        />
                        <span className="flex-1 truncate text-text text-xs">{item.name}</span>
                        {item.isCurrent && <Check size={10} className="text-accent" />}
                        {!item.isCurrent && item.isInstalled && item.id !== "custom" && (
                          <Check size={10} className="text-green-500" />
                        )}
                      </button>
                    );
                  }

                  if (item.type === "model") {
                    selectableIndex++;
                    const itemIndex = selectableIndex;
                    const isSelected = itemIndex === selectedIndex;

                    return (
                      <button
                        key={`${item.providerId}-${item.id}`}
                        onClick={() => handleModelSelect(item.providerId!, item.id)}
                        onMouseEnter={() => setSelectedIndex(itemIndex)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                          isSelected ? "bg-hover" : "bg-transparent",
                          item.isCurrent && "bg-accent/10",
                        )}
                      >
                        <span className="flex-1 truncate text-text text-xs">{item.name}</span>
                        {item.isCurrent && <Check size={10} className="text-accent" />}
                      </button>
                    );
                  }

                  return null;
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
