import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Download, LoaderCircle, Plus, Search, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/store/store";
import type { AgentConfig } from "@/features/ai/types/acp";
import { AGENT_OPTIONS, type AgentType } from "@/features/ai/types/ai-chat";
import { useToast } from "@/features/layout/contexts/toast-context";
import { Button } from "@/ui/button";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { paneIconButtonClassName } from "@/ui/pane";
import { cn } from "@/utils/cn";

interface UnifiedAgentSelectorProps {
  variant?: "header" | "input";
  onOpenSettings?: () => void;
}

export function UnifiedAgentSelector({
  variant = "header",
  onOpenSettings,
}: UnifiedAgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [availableAgents, setAvailableAgents] = useState<AgentConfig[]>([]);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const { showToast } = useToast();
  const getCurrentAgentId = useAIChatStore((state) => state.getCurrentAgentId);
  const setSelectedAgentId = useAIChatStore((state) => state.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const changeCurrentChatAgent = useAIChatStore((state) => state.changeCurrentChatAgent);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentAgentId = getCurrentAgentId();
  const currentAgent = AGENT_OPTIONS.find((a) => a.id === currentAgentId);
  const agentConfigById = useMemo(
    () => new Map(availableAgents.map((agent) => [agent.id, agent])),
    [availableAgents],
  );

  const reloadAgents = useCallback(async () => {
    try {
      const detectedAgents = await invoke<AgentConfig[]>("get_available_agents");
      setAvailableAgents(detectedAgents);
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
    const detectAgents = async () => {
      try {
        const availableAgents = await invoke<AgentConfig[]>("get_available_agents");
        setAvailableAgents(availableAgents);
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

  // Build filtered items list
  const filteredItems = useMemo(() => {
    const items: Array<{
      type: "agent";
      id: string;
      name: string;
      isInstalled?: boolean;
      canInstall?: boolean;
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
      items.push({
        type: "agent",
        id: agent.id,
        name: agent.name,
        isInstalled: installedAgents.has(agent.id),
        canInstall: agentConfigById.get(agent.id)?.canInstall,
        isCurrent: agent.id === currentAgentId,
      });
    }

    return items;
  }, [search, installedAgents, agentConfigById, currentAgentId]);

  const selectableItems = filteredItems;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

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
        createNewChat(agentId);
      } else {
        changeCurrentChatAgent(agentId);
      }
    },
    [variant, currentAgentId, setSelectedAgentId, changeCurrentChatAgent, createNewChat],
  );

  const handleInstallAgent = useCallback(
    async (agentId: string) => {
      const agent = agentConfigById.get(agentId);
      if (!agent?.canInstall || installingAgentId === agentId) {
        return;
      }

      setInstallingAgentId(agentId);
      try {
        await invoke<AgentConfig>("install_acp_agent", { agentId });
        await reloadAgents();
        showToast({
          message: `${agent.name} installed successfully`,
          type: "success",
        });
      } catch (error) {
        showToast({
          message: `Failed to install ${agent.name}: ${error instanceof Error ? error.message : String(error)}`,
          type: "error",
        });
      } finally {
        setInstallingAgentId(null);
      }
    },
    [agentConfigById, installingAgentId, reloadAgents, showToast],
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
            } else {
              void handleInstallAgent(item.id);
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
        <Button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          variant="ghost"
          size="icon-sm"
          className={paneIconButtonClassName()}
          aria-label="New chat"
          title="New chat"
        >
          <Plus />
        </Button>
      ) : (
        <Button
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          type="button"
          variant="ghost"
          size="sm"
          className="ui-font flex h-8 items-center gap-1.5 rounded-full border border-border bg-secondary-bg/80 px-3 text-xs transition-colors hover:bg-hover"
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
        anchorAlign="end"
        onClose={() => setIsOpen(false)}
        className="flex w-[320px] flex-col overflow-hidden rounded-2xl p-0"
      >
        <div className="bg-secondary-bg px-2 py-2" onKeyDown={handleKeyDown}>
          <Input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search agents..."
            variant="ghost"
            leftIcon={Search}
            className="w-full pr-3"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-text-lighter text-xs">No results found</div>
          ) : (
            filteredItems.map((item) => {
              selectableIndex++;
              const itemIndex = selectableIndex;
              const isSelected = itemIndex === selectedIndex;
              const isInstalling = installingAgentId === item.id;
              const isUnavailable = !item.isInstalled && item.id !== "custom";

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  className={cn(
                    "group flex min-h-10 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                    isSelected ? "bg-hover/90" : "bg-transparent",
                    item.isCurrent && "bg-selected/90 ring-1 ring-accent/10",
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      item.isInstalled || item.id === "custom"
                        ? handleAgentChange(item.id as AgentType)
                        : handleInstallAgent(item.id)
                    }
                    className="h-auto min-w-0 flex-1 justify-start gap-2 px-0 py-0 hover:bg-transparent"
                  >
                    <ProviderIcon providerId={item.id} size={10} className="text-text-lighter" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-text text-xs">{item.name}</div>
                      {isUnavailable ? (
                        <div className="mt-0.5 text-[10px] text-text-lighter">
                          Install before use
                        </div>
                      ) : null}
                    </div>
                  </Button>
                  <div className="flex min-w-18 shrink-0 items-center justify-end gap-1">
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
                        aria-label="Open Athas Agent settings"
                        title="Athas Agent settings"
                      >
                        <Settings2 />
                      </Button>
                    ) : null}
                    {item.isCurrent && <Check className="shrink-0 text-accent" />}
                    {!item.isCurrent && item.isInstalled && item.id !== "custom" && (
                      <Check className="shrink-0 text-green-500" />
                    )}
                    {isUnavailable && item.canInstall ? (
                      <Button
                        type="button"
                        onClick={() => void handleInstallAgent(item.id)}
                        disabled={isInstalling}
                        variant="outline"
                        size="xs"
                        className="h-6 shrink-0 gap-1 rounded-full bg-secondary-bg/80 px-2 py-0 text-[10px] text-text-lighter disabled:cursor-wait disabled:opacity-70"
                      >
                        {isInstalling ? <LoaderCircle className="animate-spin" /> : <Download />}
                        {isInstalling ? "Installing" : "Install"}
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
