import { useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuEmpty,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuViewport,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/ui/dropdown";
import { useMenuSearch } from "@/ui/menu-search";
import { ArrowClockwiseIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";

export interface ComposerModelOption {
  id: string;
  name: string;
  keywords?: string[];
}

function ModelItems({
  models,
  selected,
  onSelect,
  loading,
  error,
  retry,
  allowCustom = false,
  emptyLabel = "No models available",
}: {
  models: ComposerModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  allowCustom?: boolean;
  emptyLabel?: string;
}) {
  const search = useMenuSearch();
  const filtered = search.filter(models, (model) => [
    model.name,
    model.id,
    ...(model.keywords ?? []),
  ]);
  const query = search.query;
  const custom = allowCustom && query.trim() && !models.some((model) => model.id === query.trim());
  return (
    <>
      <DropdownMenuSearch
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
        placeholder="Search models..."
      />
      <DropdownMenuViewport>
        {loading ? (
          <DropdownMenuItem disabled>
            <Spinner label="Loading models" compact />
            Loading models…
          </DropdownMenuItem>
        ) : null}
        {error ? (
          <DropdownMenuItem closeOnClick={false} title={error} disabled={!retry} onClick={retry}>
            <WarningIcon />
            Could not load models{retry ? <ArrowClockwiseIcon /> : null}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
          {filtered.map((model) => (
            <DropdownMenuRadioItem key={model.id} value={model.id} closeOnClick>
              {model.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {custom ? (
          <DropdownMenuItem onClick={() => onSelect(query.trim())}>
            Use {query.trim()}
          </DropdownMenuItem>
        ) : null}
        {!filtered.length && !custom && !loading && !error ? (
          <DropdownMenuEmpty>{emptyLabel}</DropdownMenuEmpty>
        ) : null}
      </DropdownMenuViewport>
    </>
  );
}

function ApiModels({
  providerId,
  modelId,
  onSelect,
}: {
  providerId: string;
  modelId: string;
  onSelect: (id: string) => void;
}) {
  const { availableModels, isCustomProvider, isLoadingModels, modelFetchError } = useAIModelOptions(
    providerId,
    modelId,
  );
  return (
    <ModelItems
      models={availableModels}
      selected={modelId}
      onSelect={onSelect}
      loading={isLoadingModels}
      error={modelFetchError}
      allowCustom={isCustomProvider || providerId === "openrouter"}
    />
  );
}

function CodexModels({ cwd, onSelect }: { cwd: string; onSelect: () => void }) {
  const { settings, update } = useCodexSettings();
  const { models, loading, error, retry } = useCodexModels(cwd);
  return (
    <ModelItems
      models={[{ id: "default", name: "Codex default" }, ...models]}
      selected={settings.model || "default"}
      onSelect={(id) => {
        update(getCodexModelPatch(id === "default" ? undefined : id, models, settings));
        onSelect();
      }}
      loading={loading}
      error={error}
      retry={retry}
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
  const [source, setSource] = useState(currentAgentId === "custom" ? "api" : "cli");
  const search = useMenuSearch();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { options, isLoading, loadError, refresh, runAgentAction } =
    useAgentOptions(currentAgentId);
  const providers = useAvailableProviders();
  const { settings } = useCodexSettings();
  const model = sessionConfigOptions.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentAgent = options.find((option) => option.id === currentAgentId);
  const iconId = currentAgentId === "custom" ? providerId : currentAgentId;
  const label =
    currentAgentId === "custom"
      ? modelId || providers.find((provider) => provider.id === providerId)?.name || "Choose model"
      : currentAgentId === CODEX_INTEGRATION_ID
        ? settings.model || "Codex default"
        : modelKind?.options.find((option) => option.id === modelKind.currentValue)?.name ||
          currentAgent?.name ||
          currentAgentId;
  const agents = search
    .filter(options, (option) => [option.name, option.id])
    .filter((option) => option.id !== "custom");
  const apis = search.filter(providers, (provider) => [provider.name, provider.id]);
  const selectAgent = (id: AgentType) => {
    if (id !== currentAgentId) onAgentChange?.(id);
  };
  return (
    <DropdownMenu
      onOpenChange={(value) => {
        if (value) {
          setSource(currentAgentId === "custom" ? "api" : "cli");
          onBeforeOpen?.();
        } else {
          search.reset();
          setExpanded(null);
        }
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
              tooltip="Change agent and model"
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
        <Tabs
          value={source}
          onValueChange={(value) => {
            setSource(String(value));
            search.reset();
            setExpanded(null);
          }}
        >
          <TabsList aria-label="Model source" className="mx-1 mt-1">
            <TabsTrigger value="cli">CLI</TabsTrigger>
            <TabsTrigger value="api">API</TabsTrigger>
          </TabsList>
          <DropdownMenuSearch
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder={source === "cli" ? "Search agents..." : "Search providers..."}
            autoFocus
          />
          <TabsContent value="cli" className="flex min-h-0 flex-col">
            <DropdownMenuViewport>
              {isLoading ? (
                <DropdownMenuItem disabled>
                  <Spinner label="Checking agents" compact />
                  Checking agents…
                </DropdownMenuItem>
              ) : null}
              {loadError ? (
                <DropdownMenuItem
                  closeOnClick={false}
                  title={loadError}
                  onClick={() => void refresh()}
                >
                  <WarningIcon />
                  Could not check all agents · Retry
                  <ArrowClockwiseIcon />
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuRadioGroup value={currentAgentId} onValueChange={selectAgent}>
                {agents.map((agent) =>
                  agent.isInstalled ? (
                    <DropdownMenuRadioItem
                      key={agent.id}
                      value={agent.id}
                      closeOnClick
                      disabled={!onAgentChange && !agent.isCurrent}
                      title={agent.description}
                    >
                      <ProviderIcon providerId={agent.id} iconUrl={agent.icon} />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                      {isTerminalAgent(agent.id) ? <span>Terminal</span> : null}
                    </DropdownMenuRadioItem>
                  ) : (
                    <DropdownMenuItem
                      key={agent.id}
                      disabled={
                        agent.isChecking || agent.isBusy || (!agent.action && !agent.needsSetup)
                      }
                      closeOnClick={agent.needsSetup}
                      onClick={() => {
                        if (agent.action) void runAgentAction(agent.id, agent.name, agent.action);
                        else if (agent.needsSetup) useUIState.getState().openSettingsDialog("ai");
                      }}
                      title={agent.description}
                    >
                      <ProviderIcon providerId={agent.id} iconUrl={agent.icon} />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                      {agent.isBusy ? (
                        <Spinner label="Installing agent" compact />
                      ) : agent.isChecking ? null : agent.action ? (
                        "Install"
                      ) : agent.needsSetup ? (
                        "Set up"
                      ) : (
                        "Unavailable"
                      )}
                    </DropdownMenuItem>
                  ),
                )}
              </DropdownMenuRadioGroup>
              {!agents.length && !isLoading && !loadError ? (
                <DropdownMenuEmpty>No matching agents</DropdownMenuEmpty>
              ) : null}
              {currentAgentId !== "custom" &&
              (currentAgentId === CODEX_INTEGRATION_ID || modelKind) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub
                    open={expanded === "model"}
                    onOpenChange={(value) => setExpanded(value ? "model" : null)}
                  >
                    <DropdownMenuSubTrigger>Model</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent viewport="searchable" size="wide">
                      {expanded === "model" ? (
                        currentAgentId === CODEX_INTEGRATION_ID ? (
                          <CodexModels cwd={cwd} onSelect={() => {}} />
                        ) : modelKind && model ? (
                          <ModelItems
                            models={modelKind.options}
                            selected={modelKind.currentValue}
                            onSelect={(value) => onSessionConfigChange(model.id, value)}
                          />
                        ) : null
                      ) : null}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              ) : null}
            </DropdownMenuViewport>
          </TabsContent>
          <TabsContent value="api" className="flex min-h-0 flex-col">
            <DropdownMenuViewport>
              {apis.map((provider) => (
                <DropdownMenuSub
                  key={provider.id}
                  open={expanded === `api:${provider.id}`}
                  onOpenChange={(value) => setExpanded(value ? `api:${provider.id}` : null)}
                >
                  <DropdownMenuSubTrigger>
                    <ProviderIcon providerId={provider.id} />
                    <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent viewport="searchable" size="wide">
                    {expanded === `api:${provider.id}` ? (
                      <ApiModels
                        providerId={provider.id}
                        modelId={
                          currentAgentId === "custom" && providerId === provider.id ? modelId : ""
                        }
                        onSelect={(id) => {
                          onModelChange(id, provider.id);
                        }}
                      />
                    ) : null}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
              {!apis.length ? <DropdownMenuEmpty>No matching providers</DropdownMenuEmpty> : null}
            </DropdownMenuViewport>
          </TabsContent>
        </Tabs>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
