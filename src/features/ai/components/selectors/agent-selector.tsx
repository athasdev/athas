import { invoke } from "@tauri-apps/api/core";
import {
  CaretDown as ChevronDown,
  Plus,
  MagnifyingGlass as Search,
  SlidersHorizontal as Settings2,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { PaneIconButton } from "@/ui/pane";
import { cn } from "@/utils/cn";

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
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const setSelectedAgentId = useAIChatStore((state) => state.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const changeCurrentChatAgent = useAIChatStore((state) => state.changeCurrentChatAgent);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousOpenSignalRef = useRef(openSignal);

  const currentAgentId = selectedAgentId ?? getCurrentAgentId();
  const currentAgent = AGENT_OPTIONS.find((a) => a.id === currentAgentId);

  const loadInstalledAgents = useCallback(async () => {
    try {
      const detectedAgents = await invoke<AgentConfig[]>("get_available_agents");
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
      isInstalled?: boolean;
      isCurrent?: boolean;
    }> = [];

    const searchLower = search.toLowerCase();
    const matchingAgents = AGENT_OPTIONS.filter(
      (agent) =>
        !search ||
        agent.name.toLowerCase().includes(searchLower) ||
        agent.description.toLowerCase().includes(searchLower),
    );

    for (const agent of matchingAgents) {
      const isInstalled = installedAgents.has(agent.id);
      if (!isInstalled && agent.id !== "custom") continue;

      items.push({
        type: "agent",
        id: agent.id,
        name: agent.name,
        isInstalled,
        isCurrent: agent.id === currentAgentId,
      });
    }

    return items;
  }, [search, installedAgents, currentAgentId]);

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

      const currentAgentInfo = AGENT_OPTIONS.find((a) => a.id === currentAgentId);
      if (currentAgentInfo?.isAcp) {
        try {
          await invoke("stop_acp_agent");
        } catch {
          // Silent fail
        }
      }

      if (variant === "header") {
        const newChatId = createNewChat(agentId);
        const nextAgentInfo = AGENT_OPTIONS.find((a) => a.id === agentId);
        if (nextAgentInfo?.isAcp) {
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
            handleAgentChange(item.id as AgentType);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [isOpen, selectableItems, selectedIndex, handleAgentChange],
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
                  onClick={() => void handleAgentChange(item.id as AgentType)}
                  className={cn(
                    "group flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                    isSelected ? "bg-hover/90" : "bg-transparent",
                    item.isCurrent && "bg-selected/90 ring-1 ring-accent/10",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ProviderIcon providerId={item.id} size={12} className="text-text-lighter" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-left text-text text-xs leading-4">
                        {item.name}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1">
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
