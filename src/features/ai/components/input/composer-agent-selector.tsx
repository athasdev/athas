import { useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  AthasModels,
  Connection,
  ModelResultsProvider,
  ProviderModels,
  useConnectedModelProviders,
  useModelName,
  useModelSearchResults,
} from "@/features/ai/components/selectors/model-connection-menu";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuViewport,
  DropdownMenuEmpty,
} from "@/ui/dropdown";
import { useMenuSearch, type MenuSearch } from "@/ui/menu-search";
import { ArrowClockwiseIcon, SlidersIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { ComposerEffortSubmenu } from "./composer-effort-selector";
import { FollowAgentMenuItem } from "./follow-agent-toggle";

function CodexModels({
  cwd,
  active,
  search,
  onSelect,
  disabled,
}: {
  cwd: string;
  active: boolean;
  search: MenuSearch;
  onSelect: () => void;
  disabled: boolean;
}) {
  const { settings, update } = useCodexSettings();
  const { models, loading, error, retry } = useCodexModels(cwd);
  return (
    <Connection
      models={[{ id: "default", name: "Default", pinned: true }, ...models]}
      selected={active ? settings.model || "default" : ""}
      onSelect={(id) => {
        update(getCodexModelPatch(id === "default" ? undefined : id, models, settings));
        onSelect();
      }}
      providerId={CODEX_INTEGRATION_ID}
      providerName="Codex"
      search={search}
      loading={loading}
      error={error}
      retry={retry}
      disabled={disabled}
      nested
    />
  );
}

interface ComposerAgentSelectorProps {
  cwd: string;
  currentAgentId: AgentType;
  providerId: string;
  modelId: string;
  sessionConfigOptions: SessionConfigOption[];
  onAgentChange?: (agentId: AgentType) => void;
  onModelChange: (modelId: string, providerId: string) => void;
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onBeforeOpen?: () => void;
  /** The chat whose agent can be followed in the editor; omitted when following is unavailable. */
  followChatId?: string | null;
}

export function ComposerAgentSelector({
  cwd,
  currentAgentId,
  providerId,
  modelId,
  sessionConfigOptions,
  onAgentChange,
  onModelChange,
  onSessionConfigChange,
  onBeforeOpen,
  followChatId,
}: ComposerAgentSelectorProps) {
  const [isContentMounted, setIsContentMounted] = useState(false);
  const search = useMenuSearch();
  const { reportResults, hasNoResults } = useModelSearchResults();
  const { options, isLoading, loadError, refresh } = useAgentOptions(currentAgentId);
  const providers = useAvailableProviders();
  const { settings } = useCodexSettings();
  const model = sessionConfigOptions.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentAgent = options.find((option) => option.id === currentAgentId);
  const iconId = currentAgentId === "custom" ? providerId : currentAgentId;
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const selectedModelName = useModelName(providerId, modelId);
  const label =
    currentAgentId === "custom"
      ? providerId === "athas" && (!modelId || modelId === "auto")
        ? "Athas Automatic"
        : selectedModelName || modelId || selectedProvider?.name || "Choose model"
      : currentAgentId === CODEX_INTEGRATION_ID
        ? settings.model || "Codex default"
        : modelKind?.options.find((option) => option.id === modelKind.currentValue)?.name ||
          currentAgent?.name ||
          currentAgentId;
  const configuredProviders = useConnectedModelProviders([providerId]);
  const agents = options.filter(
    (option) => option.id !== "custom" && (option.isInstalled || option.isCurrent),
  );
  const selectAgent = (id: AgentType) => {
    if (id !== currentAgentId) onAgentChange?.(id);
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setIsContentMounted(open);
        if (open) onBeforeOpen?.();
        else search.reset();
      }}
    >
      <span className="inline-flex min-w-0 max-w-52">
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              truncate
              aria-label="Change model"
              tooltip="Change model"
            />
          }
        >
          <ProviderIcon
            providerId={iconId}
            iconUrl={currentAgentId === "custom" ? undefined : currentAgent?.icon}
          />
          <span className="min-w-0 truncate">{label}</span>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="start" side="top" viewport="searchable" size="wide">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Select a model…"
          autoFocus
        />
        <DropdownMenuViewport>
          <ModelResultsProvider value={reportResults}>
            {isContentMounted ? (
              <AthasModels
                selected={
                  currentAgentId === "custom" && providerId === "athas" ? modelId || "auto" : ""
                }
                search={search}
                onSelect={(id) => onModelChange(id, "athas")}
              />
            ) : null}
            {isContentMounted
              ? configuredProviders.map((provider) => (
                  <ProviderModels
                    key={provider.id}
                    providerId={provider.id}
                    providerName={provider.name}
                    selected={
                      currentAgentId === "custom" && provider.id === providerId ? modelId : ""
                    }
                    search={search}
                    onSelect={(id) => onModelChange(id, provider.id)}
                  />
                ))
              : null}
            {agents.map((agent) =>
              agent.id === CODEX_INTEGRATION_ID ? (
                isContentMounted ? (
                  <CodexModels
                    key={agent.id}
                    cwd={cwd}
                    active={currentAgentId === agent.id}
                    search={search}
                    onSelect={() => selectAgent(agent.id)}
                    disabled={!onAgentChange && !agent.isCurrent}
                  />
                ) : null
              ) : (
                <Connection
                  key={agent.id}
                  models={
                    agent.isCurrent && modelKind
                      ? modelKind.options
                      : [
                          {
                            id: "default",
                            name: isTerminalAgent(agent.id) ? agent.name : "Default",
                          },
                        ]
                  }
                  selected={agent.isCurrent ? (modelKind?.currentValue ?? "default") : ""}
                  onSelect={(value) => {
                    if (agent.isCurrent && model) onSessionConfigChange(model.id, value);
                    else selectAgent(agent.id);
                  }}
                  providerId={agent.id}
                  providerName={isTerminalAgent(agent.id) ? "Terminal" : agent.name}
                  iconUrl={agent.icon}
                  search={search}
                  disabled={!onAgentChange && !agent.isCurrent}
                  nested={agent.isCurrent && (modelKind?.options.length ?? 0) > 1}
                />
              ),
            )}
            {!search.isSearching && isLoading ? (
              <DropdownMenuItem disabled>
                <Spinner compact label="Loading connections" />
                Loading connections…
              </DropdownMenuItem>
            ) : null}
            {!search.isSearching && loadError ? (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => void refresh()}
                title={loadError}
              >
                <WarningIcon />
                <span className="min-w-0 whitespace-normal">{loadError}</span>
                <ArrowClockwiseIcon />
              </DropdownMenuItem>
            ) : null}
          </ModelResultsProvider>
          {isContentMounted && search.isSearching && !isLoading && !loadError && hasNoResults ? (
            <DropdownMenuEmpty>No matching models</DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
        <DropdownMenuSeparator />
        {isContentMounted ? (
          <ComposerEffortSubmenu
            cwd={cwd}
            currentAgentId={currentAgentId}
            sessionConfigOptions={sessionConfigOptions}
            onSessionConfigChange={onSessionConfigChange}
          />
        ) : null}
        {followChatId ? <FollowAgentMenuItem chatId={followChatId} /> : null}
        <DropdownMenuItem onClick={() => useUIState.getState().openSettings("ai")}>
          <SlidersIcon />
          Configure models…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
