import { invoke } from "@tauri-apps/api/core";
import {
  CaretDownIcon as ChevronDown,
  PlusIcon as Plus,
  MagnifyingGlassIcon as Search,
  SlidersHorizontalIcon as Settings2,
} from "@/ui/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { Spinner } from "@/ui/spinner";
import { Button } from "@/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/ui/combobox";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
import {
  CLAUDE_CODE_TERMINAL_AGENT_ID,
  CLAUDE_CODE_TERMINAL_OPTION,
} from "@/features/ai/lib/claude-code";
import { openClaudeCodeTerminal } from "@/features/ai/lib/claude-code-terminal";

const ATHAS_AGENT_OPTION = {
  id: "custom",
  name: "Athas Agent",
  description: "Use Athas Agent settings and provider configuration",
  isAcp: false,
};

type AgentSelectorItem = {
  type: "agent";
  id: string;
  name: string;
  description: string;
  isInstalled: boolean;
  isCurrent: boolean;
  canInstall: boolean;
  isInstalling: boolean;
};

interface AgentSelectorProps {
  variant?: "header" | "input";
  onOpenSettings?: () => void;
  selectedAgentId?: AgentType;
  onSelectAgent?: (agentId: AgentType) => void;
  portalContainer?: Element | DocumentFragment | null;
  triggerClassName?: string;
  triggerTooltip?: string;
}

export function AgentSelector({
  variant = "header",
  onOpenSettings,
  selectedAgentId,
  onSelectAgent,
  portalContainer,
  triggerClassName,
  triggerTooltip,
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(["custom"]));
  const [agentConfigs, setAgentConfigs] = useState<Map<string, AgentConfig>>(new Map());
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const getCurrentAgentId = useAIChatStore((state) => state.actions.getCurrentAgentId);
  const setSelectedAgentId = useAIChatStore((state) => state.actions.setSelectedAgentId);
  const createNewChat = useAIChatStore((state) => state.actions.createNewChat);
  const changeCurrentChatAgent = useAIChatStore((state) => state.actions.changeCurrentChatAgent);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;

  const currentAgentId = selectedAgentId ?? getCurrentAgentId();
  const currentAgent =
    currentAgentId === CLAUDE_CODE_TERMINAL_AGENT_ID
      ? CLAUDE_CODE_TERMINAL_OPTION
      : (agentConfigs.get(currentAgentId) ?? ATHAS_AGENT_OPTION);

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
    const items: AgentSelectorItem[] = [];

    const searchLower = search.toLowerCase();
    const registryAgents = Array.from(agentConfigs.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const availableAgents = [ATHAS_AGENT_OPTION, CLAUDE_CODE_TERMINAL_OPTION, ...registryAgents];
    const matchingAgents = availableAgents.filter(
      (agent) =>
        !search ||
        agent.name.toLowerCase().includes(searchLower) ||
        (agent.description ?? "").toLowerCase().includes(searchLower),
    );

    for (const agent of matchingAgents) {
      const isInstalled = installedAgents.has(agent.id);
      const agentConfig = agentConfigs.get(agent.id);
      const isClaudeCodeTerminal = agent.id === CLAUDE_CODE_TERMINAL_AGENT_ID;

      items.push({
        type: "agent",
        id: agent.id,
        name: agent.name,
        description: agentConfig?.description ?? agent.description ?? "ACP-compatible coding agent",
        isInstalled: isClaudeCodeTerminal || isInstalled,
        isCurrent: agent.id === currentAgentId,
        canInstall:
          agent.id === "custom" || isClaudeCodeTerminal ? false : (agentConfig?.canInstall ?? true),
        isInstalling: installingAgentId === agent.id,
      });
    }

    return items;
  }, [search, installedAgents, currentAgentId, agentConfigs, installingAgentId]);

  const closeAgentSelector = useCallback(() => {
    setSearch("");
    setIsOpen(false);
  }, []);

  const handleAgentChange = useCallback(
    async (agentId: AgentType) => {
      if (onSelectAgent) {
        closeAgentSelector();
        onSelectAgent(agentId);
        return;
      }

      if (agentId === CLAUDE_CODE_TERMINAL_AGENT_ID) {
        closeAgentSelector();
        openClaudeCodeTerminal();
        return;
      }

      if (variant !== "header" && agentId === currentAgentId) {
        closeAgentSelector();
        return;
      }

      closeAgentSelector();
      setSelectedAgentId(agentId);

      if (currentAgentId !== "custom") {
        try {
          await invoke("stop_acp_agent");
        } catch {
          // Silent fail
        }
      }

      if (variant === "header") {
        const newChatId = createNewChat(agentId, { activate: false });
        openAgentBuffer(newChatId);
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
      closeAgentSelector,
      onSelectAgent,
      variant,
      currentAgentId,
      setSelectedAgentId,
      changeCurrentChatAgent,
      createNewChat,
      openAgentBuffer,
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
        toast.error(`Failed to install ${agentName}`, {
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setInstallingAgentId(null);
        void loadInstalledAgents();
      }
    },
    [installingAgentId, loadInstalledAgents],
  );

  return (
    <Combobox<AgentSelectorItem>
      items={filteredItems}
      value={null}
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      onValueChange={(item) => {
        if (!item) return;
        if (item.isInstalled || item.id === "custom") {
          void handleAgentChange(item.id as AgentType);
        } else if (item.canInstall) {
          void handleInstallAgent(item.id as AgentType, item.name);
        }
      }}
      itemToStringLabel={(item) => item.name}
      itemToStringValue={(item) => item.id}
      isItemEqualToValue={(left, right) => left.id === right.id}
      filter={() => true}
      autoHighlight
    >
      {variant === "header" ? (
        <ComboboxTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              tooltip={triggerTooltip ?? "New session"}
              className={triggerClassName}
            />
          }
          className="size-auto"
        >
          <Plus />
        </ComboboxTrigger>
      ) : (
        <ComboboxTrigger
          render={
            <Button type="button" variant="ghost" size="sm" className="max-w-[min(220px,100%)]" />
          }
          className="size-auto"
        >
          <ProviderIcon providerId={currentAgentId} size={11} className="text-subtle-foreground" />
          <span className="max-w-[140px] truncate text-foreground">
            {currentAgent?.name || "Agent"}
          </span>
          <ChevronDown
            className={cn("text-subtle-foreground transition-transform", isOpen && "rotate-180")}
          />
        </ComboboxTrigger>
      )}

      <ComboboxContent
        side="bottom"
        align="end"
        portalContainer={portalContainer as HTMLElement | ShadowRoot | null}
        className="flex w-[min(280px,calc(100vw-16px))] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl p-0"
        style={{ maxHeight: "240px" }}
      >
        <div className="bg-surface px-1.5 py-1.5">
          <ComboboxInput
            placeholder="Search agents..."
            variant="ghost"
            size="xs"
            leftIcon={Search}
            showTrigger={false}
            className="w-full pr-3"
            aria-label="Search agents"
            autoFocus
          />
        </div>

        <ComboboxList className="min-h-0 flex-1 p-1">
          <ComboboxEmpty>No results found</ComboboxEmpty>
          {filteredItems.map((item) => (
            <ComboboxItem
              key={item.id}
              value={item}
              showIndicator={false}
              className={cn(
                "group min-h-7 cursor-pointer gap-2 py-1",
                item.isCurrent && "bg-selected/90 ring-1 ring-primary/10",
                !item.isInstalled && item.id !== "custom" && "text-subtle-foreground",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <ProviderIcon providerId={item.id} size={12} className="text-subtle-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-left text-foreground ui-text-sm leading-4">
                    {item.name}
                  </div>
                  {!item.isInstalled && item.id !== "custom" ? (
                    <div className="truncate text-left ui-text-sm text-subtle-foreground leading-3">
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
                    className="h-6 px-2 ui-text-sm"
                    disabled={!item.canInstall || Boolean(installingAgentId)}
                  >
                    {item.isInstalling ? <Spinner label="Installing" compact /> : "Install"}
                  </Button>
                ) : null}
                {item.id === "custom" && onOpenSettings ? (
                  <Button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeAgentSelector();
                      onOpenSettings();
                    }}
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      item.isCurrent
                        ? "bg-primary/15 text-primary"
                        : "text-subtle-foreground hover:bg-surface hover:text-foreground",
                    )}
                    tooltip="Athas Agent settings"
                    aria-label="Open Athas Agent settings"
                  >
                    <Settings2 />
                  </Button>
                ) : null}
              </div>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
