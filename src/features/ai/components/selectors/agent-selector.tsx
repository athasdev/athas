import { invoke } from "@tauri-apps/api/core";
import {
  CaretDown as ChevronDown,
  Plus,
  MagnifyingGlass as Search,
  SlidersHorizontal as Settings2,
  SpinnerGap,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig } from "@/features/ai/types/acp";
import type { AgentType } from "@/features/ai/types/ai-chat";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { PaneIconButton } from "@/ui/pane";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";

const ATHAS_AGENT_OPTION = {
  id: "custom",
  name: "Athas Agent",
  description: "Use Athas chat settings and provider configuration",
  isAcp: false,
};

interface AgentSelectorProps {
  variant?: "header" | "input";
  onOpenSettings?: () => void;
  selectedAgentId?: AgentType;
  onSelectAgent?: (agentId: AgentType) => void;
  portalContainer?: Element | DocumentFragment | null;
  triggerClassName?: string;
  triggerTooltip?: string;
  openSignal?: number;
}

export function AgentSelector({
  variant = "header",
  onOpenSettings,
  selectedAgentId,
  onSelectAgent,
  portalContainer,
  triggerClassName,
  triggerTooltip,
  openSignal,
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [agentConfigs, setAgentConfigs] = useState<Map<string, AgentConfig>>(new Map());
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const setSelectedAgentId = useAIChatStore((state) => state.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const changeCurrentChatAgent = useAIChatStore((state) => state.changeCurrentChatAgent);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousOpenSignalRef = useRef(openSignal);

  const currentAgentId = selectedAgentId ?? getCurrentAgentId();
  const currentAgent = agentConfigs.get(currentAgentId) ?? ATHAS_AGENT_OPTION;

  const loadInstalledAgents = useCallback(async () => {
    try {
      const detectedAgents = await invoke<AgentConfig[]>("get_available_agents");
      setAgentConfigs(new Map(detectedAgents.map((agent) => [agent.id, agent])));
      const installed = new Set<string>(["custom"]);
      for (const agent of detectedAgents) {
        if (agent.installed) {
          installed.add(agent.id);
        }
      }
      setInstalledAgents(installed);
    } catch {
      // Silent fail
    }
  }, []);

  // Detect installed agents
  useEffect(() => {
    void loadInstalledAgents();
  }, [loadInstalledAgents]);

  // Build filtered items list
  const filteredItems = useMemo(() => {
    const items: Array<{
      type: "agent";
      id: string;
      name: string;
      description: string;
      isInstalled?: boolean;
      isCurrent?: boolean;
      canInstall?: boolean;
      isInstalling?: boolean;
    }> = [];

    const searchLower = search.toLowerCase();
    const registryAgents = Array.from(agentConfigs.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const availableAgents = [ATHAS_AGENT_OPTION, ...registryAgents];
    const matchingAgents = availableAgents.filter(
      (agent) =>
        !search ||
        agent.name.toLowerCase().includes(searchLower) ||
        (agent.description ?? "").toLowerCase().includes(searchLower),
    );

    for (const agent of matchingAgents) {
      const isInstalled = installedAgents.has(agent.id);
      const agentConfig = agentConfigs.get(agent.id);

      items.push({
        type: "agent",
        id: agent.id,
        name: agent.name,
        description: agentConfig?.description ?? agent.description ?? "ACP-compatible coding agent",
        isInstalled,
        isCurrent: agent.id === currentAgentId,
        canInstall: agent.id === "custom" ? false : (agentConfig?.canInstall ?? true),
        isInstalling: installingAgentId === agent.id,
      });
    }

    return items;
  }, [search, installedAgents, currentAgentId, agentConfigs, installingAgentId]);

  const selectableItems = filteredItems;

  useEffect(() => {
    if (!isOpen) return;

    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (openSignal === undefined || openSignal === previousOpenSignalRef.current) return;
    previousOpenSignalRef.current = openSignal;
    setIsOpen(true);
  }, [openSignal]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const handleAgentChange = useCallback(
    async (agentId: AgentType) => {
      if (onSelectAgent) {
        setIsOpen(false);
        onSelectAgent(agentId);
        return;
      }

      if (variant !== "header" && agentId === currentAgentId) {
        setIsOpen(false);
        return;
      }

      setIsOpen(false);
      setSelectedAgentId(agentId);

      if (currentAgentId !== "custom") {
        try {
          await invoke("stop_acp_agent");
        } catch {
          // Silent fail
        }
      }

      if (variant === "header") {
        const newChatId = createNewChat(agentId);
        if (agentId !== "custom") {
          void AcpStreamHandler.warmup(agentId, newChatId).catch((error) => {
            console.error(`Failed to prepare ${agentId} session:`, error);
          });
        }
      } else {
        changeCurrentChatAgent(agentId);
      }
    },
    [
      onSelectAgent,
      variant,
      currentAgentId,
      setSelectedAgentId,
      changeCurrentChatAgent,
      createNewChat,
    ],
  );

  const handleInstallAgent = useCallback(
    async (agentId: AgentType, agentName: string) => {
      if (agentId === "custom" || installingAgentId) return;

      setInstallingAgentId(agentId);
      try {
        const installedAgent = await invoke<AgentConfig>("install_acp_agent", { agentId });
        setAgentConfigs((current) => {
          const next = new Map(current);
          next.set(installedAgent.id, installedAgent);
          return next;
        });
        setInstalledAgents((current) => new Set(current).add(installedAgent.id));
        toast.success(`${agentName} installed`);
      } catch (error) {
        toast.error(
          `Failed to install ${agentName}`,
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setInstallingAgentId(null);
        void loadInstalledAgents();
      }
    },
    [installingAgentId, loadInstalledAgents],
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
            if (item.isInstalled || item.id === "custom") {
              handleAgentChange(item.id as AgentType);
            } else if (item.canInstall) {
              void handleInstallAgent(item.id as AgentType, item.name);
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, selectableItems, selectedIndex, handleAgentChange, handleInstallAgent],
  );

  let selectableIndex = -1;

  return (
    <>
      {variant === "header" ? (
        <PaneIconButton
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          tooltip={triggerTooltip ?? "New chat"}
          className={triggerClassName}
        >
          <Plus />
        </PaneIconButton>
      ) : (
        <Button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          variant="ghost"
          size="sm"
          className="ui-font flex h-8 max-w-[min(220px,100%)] items-center gap-1.5 rounded-full border border-border bg-secondary-bg/80 px-3 text-xs transition-colors hover:bg-hover"
        >
          <ProviderIcon providerId={currentAgentId} size={11} className="text-text-lighter" />
          <span className="max-w-[140px] truncate text-text">{currentAgent?.name || "Agent"}</span>
          <ChevronDown
            className={cn("text-text-lighter transition-transform", isOpen && "rotate-180")}
          />
        </Button>
      )}

      <Dropdown
        isOpen={isOpen}
        anchorRef={triggerRef}
        anchorSide="bottom"
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        portalContainer={portalContainer}
        className="flex w-[min(280px,calc(100vw-16px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl p-0"
        style={{ maxHeight: "240px" }}
      >
        <div className="bg-secondary-bg px-1.5 py-1.5" onKeyDown={handleKeyDown}>
          <Input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search agents..."
            variant="ghost"
            size="xs"
            leftIcon={Search}
            className="w-full pr-3"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1 [overscroll-behavior:contain]">
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No results found</div>
          ) : (
            filteredItems.map((item) => {
              selectableIndex++;
              const itemIndex = selectableIndex;
              const isSelected = itemIndex === selectedIndex;

              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={-1}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  onClick={() => {
                    if (item.isInstalled || item.id === "custom") {
                      void handleAgentChange(item.id as AgentType);
                      return;
                    }
                    if (item.canInstall) {
                      void handleInstallAgent(item.id as AgentType, item.name);
                    }
                  }}
                  className={cn(
                    "group flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                    isSelected ? "bg-hover/90" : "bg-transparent",
                    item.isCurrent && "bg-selected/90 ring-1 ring-accent/10",
                    !item.isInstalled && item.id !== "custom" && "text-text-lighter",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ProviderIcon providerId={item.id} size={12} className="text-text-lighter" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-left text-text text-xs leading-4">
                        {item.name}
                      </div>
                      {!item.isInstalled && item.id !== "custom" ? (
                        <div className="truncate text-left text-[10px] text-text-lighter leading-3">
                          {item.canInstall ? "Not installed" : item.description}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1">
                    {!item.isInstalled && item.id !== "custom" ? (
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleInstallAgent(item.id as AgentType, item.name);
                        }}
                        variant="ghost"
                        size="xs"
                        className="h-6 px-2 text-[10px]"
                        disabled={!item.canInstall || Boolean(installingAgentId)}
                      >
                        {item.isInstalling ? <SpinnerGap className="animate-spin" /> : "Install"}
                      </Button>
                    ) : null}
                    {item.id === "custom" && onOpenSettings ? (
                      <Button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsOpen(false);
                          onOpenSettings();
                        }}
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          item.isCurrent
                            ? "bg-accent/15 text-accent"
                            : "text-text-lighter hover:bg-secondary-bg hover:text-text",
                        )}
                        tooltip="Athas Agent settings"
                        aria-label="Open Athas Agent settings"
                      >
                        <Settings2 />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Dropdown>
    </>
  );
}
