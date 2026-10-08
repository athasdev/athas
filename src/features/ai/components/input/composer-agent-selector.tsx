import { useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  AthasModelSections,
  ModelResultsProvider,
  ModelSection,
  ProviderModels,
  useConnectedModelProviders,
  useModelName,
  useModelSearchResults,
} from "@/features/ai/components/selectors/model-connection-menu";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { getModelIconId } from "@/features/ai/lib/model-vendor";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFooter,
  DropdownMenuItem,
  DropdownMenuSearch,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { SlidersIcon } from "@/ui/icons";
import { useMenuSearch, type MenuSearch } from "@/ui/menu-search";
import { ComposerEffortSelector } from "./composer-effort-selector";
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
    <ModelSection
      id={CODEX_INTEGRATION_ID}
      label="Codex"
      models={[{ id: "default", name: "Default" }, ...models]}
      selected={active ? settings.model || "default" : ""}
      onSelect={(id) => {
        update(getCodexModelPatch(id === "default" ? undefined : id, models, settings));
        onSelect();
      }}
      providerId={CODEX_INTEGRATION_ID}
      search={search}
      loading={loading}
      error={error}
      retry={retry}
      disabled={disabled}
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

/**
 * The composer's model button: one searchable list with a section per connection
 * (Recommended, Athas, each connected provider, then agents), plus a reasoning effort chip
 * beside it when the current model has an effort scale.
 */
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
  const { settings } = useCodexSettings();
  const model = sessionConfigOptions.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentAgent = options.find((option) => option.id === currentAgentId);
  const iconId = currentAgentId === "custom" ? getModelIconId(providerId, modelId) : currentAgentId;
  const selectedModelName = useModelName(providerId, modelId);
  const label =
    currentAgentId === "custom"
      ? providerId === "athas" && (!modelId || modelId === "auto")
        ? "Automatic"
        : selectedModelName || modelId || "Choose model"
      : currentAgentId === CODEX_INTEGRATION_ID
        ? settings.model || "Default"
        : modelKind?.options.find((option) => option.id === modelKind.currentValue)?.name ||
          currentAgent?.name ||
          currentAgentId;
  const configuredProviders = useConnectedModelProviders([providerId]);
  const agents = options.filter(
    (option) => option.id !== "custom" && (option.isInstalled || option.isCurrent),
  );
  const codexAgent = agents.find((agent) => agent.id === CODEX_INTEGRATION_ID);
  const modelAgent =
    currentAgent &&
    currentAgent.id !== CODEX_INTEGRATION_ID &&
    model &&
    (modelKind?.options.length ?? 0) > 1
      ? currentAgent
      : null;
  const otherAgents = agents.filter(
    (agent) => agent.id !== CODEX_INTEGRATION_ID && agent.id !== modelAgent?.id,
  );
  const selectAgent = (id: AgentType) => {
    if (id !== currentAgentId) onAgentChange?.(id);
  };
  const customSelection = (id: string) => (currentAgentId === "custom" ? id : "");

  return (
    <>
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
            {isContentMounted ? (
              <ModelResultsProvider value={reportResults}>
                <AthasModelSections
                  selected={customSelection(providerId === "athas" ? modelId || "auto" : "")}
                  search={search}
                  onSelect={(id) => onModelChange(id, "athas")}
                />
                {configuredProviders.map((provider) => (
                  <ProviderModels
                    key={provider.id}
                    providerId={provider.id}
                    providerName={provider.name}
                    selected={customSelection(provider.id === providerId ? modelId : "")}
                    search={search}
                    onSelect={(id) => onModelChange(id, provider.id)}
                  />
                ))}
                {codexAgent ? (
                  <CodexModels
                    cwd={cwd}
                    active={currentAgentId === CODEX_INTEGRATION_ID}
                    search={search}
                    onSelect={() => selectAgent(CODEX_INTEGRATION_ID)}
                    disabled={!onAgentChange && !codexAgent.isCurrent}
                  />
                ) : null}
                {modelAgent && model && modelKind ? (
                  <ModelSection
                    id={modelAgent.id}
                    label={modelAgent.name}
                    models={modelKind.options.map((option) => ({
                      id: option.id,
                      name: option.name,
                      tooltip: option.description
                        ? `${option.name} · ${option.description}`
                        : undefined,
                      iconId: modelAgent.id,
                      iconUrl: modelAgent.icon,
                    }))}
                    selected={modelKind.currentValue}
                    onSelect={(value) => onSessionConfigChange(model.id, value)}
                    providerId={modelAgent.id}
                    search={search}
                  />
                ) : null}
                <ModelSection
                  id="agents"
                  label="Agents"
                  models={otherAgents.map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                    iconId: agent.id,
                    iconUrl: agent.icon,
                    disabled: !onAgentChange && !agent.isCurrent,
                  }))}
                  selected={otherAgents.some((agent) => agent.isCurrent) ? currentAgentId : ""}
                  onSelect={(id) => selectAgent(id)}
                  providerId="custom"
                  search={search}
                  loading={isLoading}
                  error={loadError}
                  retry={() => void refresh()}
                />
              </ModelResultsProvider>
            ) : null}
            {isContentMounted && search.isSearching && hasNoResults ? (
              <DropdownMenuEmpty>No matching models</DropdownMenuEmpty>
            ) : null}
          </DropdownMenuViewport>
          <DropdownMenuFooter>
            {followChatId ? <FollowAgentMenuItem chatId={followChatId} /> : null}
            <DropdownMenuItem onClick={() => useUIState.getState().openSettings("ai")}>
              <SlidersIcon />
              Configure models…
            </DropdownMenuItem>
          </DropdownMenuFooter>
        </DropdownMenuContent>
      </DropdownMenu>
      <ComposerEffortSelector
        cwd={cwd}
        currentAgentId={currentAgentId}
        sessionConfigOptions={sessionConfigOptions}
        onSessionConfigChange={onSessionConfigChange}
        onBeforeOpen={onBeforeOpen}
      />
    </>
  );
}
