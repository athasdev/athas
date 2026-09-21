import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuViewport,
  DropdownMenuEmpty,
} from "@/ui/dropdown";
import { useMenuSearch, type MenuSearch } from "@/ui/menu-search";
import { ArrowClockwiseIcon, SlidersIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

const ModelResultsContext = createContext<((id: string, count: number) => void) | null>(null);

interface ModelOption {
  id: string;
  name: string;
  keywords?: string[];
}

function ModelRows({
  models,
  selected,
  onSelect,
  providerId,
  providerName,
  search,
  loading,
  error,
  retry,
  disabled = false,
}: {
  models: ModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  providerId: string;
  providerName: string;
  search: MenuSearch;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  disabled?: boolean;
}) {
  const filtered = search.filter(models, (model) => [
    model.name,
    model.id,
    providerName,
    ...(model.keywords ?? []),
  ]);
  const showStatus =
    !search.isSearching ||
    search.filter([{ name: providerName }], (provider) => [provider.name]).length > 0;
  const reportResults = useContext(ModelResultsContext);
  const count = filtered.length + (showStatus && (loading || error) ? 1 : 0);
  useEffect(() => {
    reportResults?.(providerId, count);
    return () => reportResults?.(providerId, 0);
  }, [count, providerId, reportResults]);
  return (
    <>
      {showStatus && loading ? (
        <DropdownMenuItem disabled>
          <Spinner label={`Loading ${providerName} models`} compact />
          Loading {providerName}…
        </DropdownMenuItem>
      ) : null}
      {showStatus && error ? (
        <DropdownMenuItem closeOnClick={false} onClick={retry} disabled={!retry} title={error}>
          <WarningIcon />
          <span className="min-w-0 whitespace-normal">
            {providerName}: {error}
          </span>
          {retry ? <ArrowClockwiseIcon /> : null}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
        {filtered.map((model) => (
          <DropdownMenuRadioItem
            key={model.id}
            value={model.id}
            closeOnClick
            disabled={disabled}
            title={`${model.name} via ${providerName}`}
          >
            <ProviderIcon providerId={providerId} />
            <span className="min-w-0 truncate">{model.name}</span>
            <span className="max-w-1/2 shrink-0 truncate text-subtle-foreground">
              via {providerName}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function ProviderModels({
  providerId,
  providerName,
  selected,
  search,
  onSelect,
}: {
  providerId: string;
  providerName: string;
  selected: string;
  search: MenuSearch;
  onSelect: (model: string) => void;
}) {
  const { availableModels, isLoadingModels, modelFetchError, retry } = useAIModelOptions(
    providerId,
    selected,
  );
  return (
    <ModelRows
      models={availableModels}
      selected={selected}
      onSelect={onSelect}
      providerId={providerId}
      providerName={providerName}
      search={search}
      loading={isLoadingModels}
      error={modelFetchError}
      retry={retry}
    />
  );
}

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
    <ModelRows
      models={[{ id: "default", name: "Default" }, ...models]}
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
}: ComposerAgentSelectorProps) {
  const [isContentMounted, setIsContentMounted] = useState(false);
  const search = useMenuSearch();
  const [resultCounts, setResultCounts] = useState<Record<string, number>>({});
  const reportResults = useCallback((id: string, count: number) => {
    setResultCounts((previous) =>
      previous[id] === count ? previous : { ...previous, [id]: count },
    );
  }, []);
  const { options, isLoading, loadError, refresh } = useAgentOptions(currentAgentId);
  const providers = useAvailableProviders();
  const providerKeys = useAIChatStore((state) => state.providerApiKeys);
  const dynamicModels = useAIChatStore((state) => state.dynamicModels);
  const { settings } = useCodexSettings();
  const model = sessionConfigOptions.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentAgent = options.find((option) => option.id === currentAgentId);
  const iconId = currentAgentId === "custom" ? providerId : currentAgentId;
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const selectedModel =
    dynamicModels[providerId]?.find((model) => model.id === modelId) ??
    selectedProvider?.models.find((model) => model.id === modelId);
  const label =
    currentAgentId === "custom"
      ? providerId === "athas" && (!modelId || modelId === "auto")
        ? "Athas Automatic"
        : selectedModel?.name || modelId || selectedProvider?.name || "Choose model"
      : currentAgentId === CODEX_INTEGRATION_ID
        ? settings.model || "Codex default"
        : modelKind?.options.find((option) => option.id === modelKind.currentValue)?.name ||
          currentAgent?.name ||
          currentAgentId;
  const configuredProviders = providers.filter(
    (provider) =>
      provider.id !== "athas" && (provider.id === providerId || providerKeys.get(provider.id)),
  );
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
      <DropdownMenuContent align="start" side="top" viewport="searchable" size="panel">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Select a model…"
          autoFocus
        />
        <DropdownMenuViewport>
          <ModelResultsContext value={reportResults}>
            <ModelRows
              models={[
                { id: "auto", name: "Automatic" },
                ...(currentAgentId === "custom" &&
                providerId === "athas" &&
                modelId &&
                modelId !== "auto"
                  ? [{ id: modelId, name: selectedModel?.name || modelId }]
                  : []),
              ]}
              selected={
                currentAgentId === "custom" && providerId === "athas" ? modelId || "auto" : ""
              }
              onSelect={(id) => onModelChange(id, "athas")}
              providerId="athas"
              providerName="Athas"
              search={search}
            />
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
                <ModelRows
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
                  search={search}
                  disabled={!onAgentChange && !agent.isCurrent}
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
          </ModelResultsContext>
          {isContentMounted &&
          !isLoading &&
          !loadError &&
          Object.values(resultCounts).every((count) => count === 0) ? (
            <DropdownMenuEmpty>No matching models</DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
          <SlidersIcon />
          Configure models…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
