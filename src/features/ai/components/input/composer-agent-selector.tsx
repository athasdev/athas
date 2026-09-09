import { useMemo, useState, type ReactNode } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import type { AgentOption } from "@/features/ai/lib/agent-options";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Badge from "@/ui/badge";
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
} from "@/ui/dropdown";
import { ArrowClockwiseIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";

export interface ComposerModelOption {
  id: string;
  name: string;
  keywords?: string[];
}

/** A CLI agent or an API provider, rendered as one flat list without section labels. */
type SourceKind = "cli" | "api";

interface SourceOption {
  value: string;
  kind: SourceKind;
  id: string;
  name: string;
  description?: string;
  agent?: AgentOption;
}

function SourceBadge({ kind }: { kind: SourceKind }) {
  return (
    <Badge variant={kind === "cli" ? "accent" : "muted"} size="compact">
      {kind === "cli" ? "CLI" : "API"}
    </Badge>
  );
}

/** Keeps a row-level control from selecting the row it sits in. */
function RowAction({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex shrink-0 items-center"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

function AgentRowAction({
  option,
  onAction,
  onSetup,
}: {
  option: AgentOption;
  onAction: () => void;
  onSetup: () => void;
}) {
  if (option.action) {
    const actionLabel = option.action === "update" ? "Update" : "Install";
    const busyLabel = option.action === "update" ? "Updating" : "Installing";
    return (
      <Button
        type="button"
        variant={option.action === "update" ? "accent-ghost" : "ghost"}
        size="chrome"
        disabled={option.isBusy}
        aria-label={`${actionLabel} ${option.name}`}
        onClick={onAction}
      >
        {option.isBusy ? <Spinner label={`${busyLabel} ${option.name}`} compact /> : null}
        {option.isBusy ? busyLabel : actionLabel}
      </Button>
    );
  }

  if (option.needsSetup) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="chrome"
        aria-label={`Set up ${option.name}`}
        onClick={onSetup}
      >
        Set up
      </Button>
    );
  }

  if (!option.isInstalled) {
    return <span className="px-1.5 text-subtle-foreground ui-text-chrome">Unavailable</span>;
  }

  return null;
}

/** Flat agent + provider list. Only mounted while the menu is open. */
function SourcePicker({
  query,
  currentAgentId,
  providerId,
  onAgentChange,
  onProviderChange,
}: {
  query: string;
  currentAgentId: AgentType;
  providerId: string;
  onAgentChange?: (agentId: AgentType) => void;
  onProviderChange: (providerId: string) => void;
}) {
  const { options, isLoading, loadError, refresh, runAgentAction } =
    useAgentOptions(currentAgentId);
  const providers = useAvailableProviders();

  const sources = useMemo<SourceOption[]>(() => {
    const agents: SourceOption[] = onAgentChange
      ? options
          .filter((option) => option.id !== "custom")
          .map((option) => ({
            value: `agent:${option.id}`,
            kind: "cli" as const,
            id: option.id,
            name: option.name,
            description: option.description,
            agent: option,
          }))
      : [];
    const apis: SourceOption[] = providers.map((provider) => ({
      value: `api:${provider.id}`,
      kind: "api" as const,
      id: provider.id,
      name: provider.name,
    }));

    return [...agents, ...apis];
  }, [onAgentChange, options, providers]);

  const filtered = sources.filter((source) =>
    matchesSearchQuery(query, [source.name, source.id, source.description ?? ""]),
  );
  const selectedValue =
    currentAgentId === "custom" ? `api:${providerId}` : `agent:${currentAgentId}`;

  return (
    <>
      {isLoading ? (
        <DropdownMenuItem disabled>
          <Spinner label="Checking agents" compact />
          Checking agents…
        </DropdownMenuItem>
      ) : null}
      {loadError ? (
        <DropdownMenuItem closeOnClick={false} title={loadError} onClick={() => void refresh()}>
          <WarningIcon />
          <span className="min-w-0 flex-1 truncate">Some agents could not be checked</span>
          <ArrowClockwiseIcon />
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuRadioGroup
        value={selectedValue}
        onValueChange={(value) => {
          const separatorIndex = value.indexOf(":");
          const kind = value.slice(0, separatorIndex);
          const id = value.slice(separatorIndex + 1);
          if (!id) return;
          if (kind === "api") {
            onProviderChange(id);
            onAgentChange?.("custom");
            return;
          }
          const agent = sources.find((source) => source.value === value)?.agent;
          if (!agent) return;
          if (agent.isInstalled) {
            onAgentChange?.(agent.id);
            return;
          }
          if (agent.action === "install") {
            void runAgentAction(agent.id, agent.name, "install");
            return;
          }
          if (agent.needsSetup) useUIState.getState().openSettingsDialog("ai");
        }}
      >
        {filtered.map((source) => {
          const agent = source.agent;

          return (
            <DropdownMenuRadioItem
              key={source.value}
              value={source.value}
              disabled={
                agent
                  ? agent.isBusy || (!agent.isInstalled && !agent.canInstall && !agent.needsSetup)
                  : undefined
              }
              closeOnClick={agent ? agent.isInstalled : true}
              title={source.description}
              aria-busy={agent?.isBusy || undefined}
              onClick={() => {
                if (agent?.isCurrent && agent.action === "update") {
                  void runAgentAction(agent.id, agent.name, "update");
                }
              }}
            >
              <ProviderIcon providerId={source.id} size={14} />
              <span className="min-w-0 flex-1 truncate">{source.name}</span>
              {agent && (agent.action || agent.needsSetup || !agent.isInstalled) ? (
                <RowAction>
                  <AgentRowAction
                    option={agent}
                    onAction={() => {
                      if (!agent.action) return;
                      void runAgentAction(agent.id, agent.name, agent.action);
                    }}
                    onSetup={() => useUIState.getState().openSettingsDialog("ai")}
                  />
                </RowAction>
              ) : null}
              <SourceBadge kind={source.kind} />
            </DropdownMenuRadioItem>
          );
        })}
        {filtered.length === 0 ? (
          <DropdownMenuItem disabled>No matching providers</DropdownMenuItem>
        ) : null}
      </DropdownMenuRadioGroup>
    </>
  );
}

interface AgentSelectorShellProps {
  iconProviderId: string;
  label: string;
  models: ComposerModelOption[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  modelsStatus?: { isLoading?: boolean; error?: string | null; onRetry?: () => void };
  allowCustomModel?: boolean;
  emptyModelsLabel?: string;
  currentAgentId: AgentType;
  providerId: string;
  onAgentChange?: (agentId: AgentType) => void;
  onProviderChange: (providerId: string) => void;
  onBeforeOpen?: () => void;
}

/**
 * One composer control for both "who answers" (CLI agent or API provider) and
 * "with which model". The source list is flat and tagged with CLI/API badges
 * instead of section headers.
 */
function AgentSelectorShell({
  iconProviderId,
  label,
  models,
  selectedModelId,
  onSelectModel,
  modelsStatus,
  allowCustomModel = false,
  emptyModelsLabel = "No models found",
  currentAgentId,
  providerId,
  onAgentChange,
  onProviderChange,
  onBeforeOpen,
}: AgentSelectorShellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const filteredModels = models.filter((model) =>
    matchesSearchQuery(query, [model.name, model.id, ...(model.keywords ?? [])]),
  );
  const canUseCustomModel =
    allowCustomModel &&
    trimmedQuery.length > 0 &&
    !models.some((model) => model.id === trimmedQuery);

  return (
    <DropdownMenu
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) onBeforeOpen?.();
        else setQuery("");
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
          <ProviderIcon providerId={iconProviderId} />
          <span className="min-w-0 truncate">{label}</span>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="start" side="top" viewport="searchable" className="w-72">
        <DropdownMenuSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search agents and models..."
          autoFocus
        />
        <DropdownMenuViewport>
          {modelsStatus?.isLoading ? (
            <DropdownMenuItem disabled>
              <Spinner label="Loading models" compact />
              Loading models…
            </DropdownMenuItem>
          ) : null}
          {modelsStatus?.error ? (
            <DropdownMenuItem
              closeOnClick={false}
              title={modelsStatus.error}
              disabled={!modelsStatus.onRetry}
              onClick={modelsStatus.onRetry}
            >
              <WarningIcon className="text-warning" />
              <span className="min-w-0 flex-1 truncate">Could not load models</span>
              {modelsStatus.onRetry ? <ArrowClockwiseIcon /> : null}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuRadioGroup value={selectedModelId} onValueChange={onSelectModel}>
            {filteredModels.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                <span className="min-w-0 flex-1 truncate">{model.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {canUseCustomModel ? (
            <DropdownMenuItem onClick={() => onSelectModel(trimmedQuery)}>
              <span className="min-w-0 flex-1 truncate">Use {trimmedQuery}</span>
            </DropdownMenuItem>
          ) : null}
          {filteredModels.length === 0 && !canUseCustomModel && !modelsStatus?.isLoading ? (
            <DropdownMenuItem disabled>{emptyModelsLabel}</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {isOpen ? (
            <SourcePicker
              query={query}
              currentAgentId={currentAgentId}
              providerId={providerId}
              onAgentChange={onAgentChange}
              onProviderChange={onProviderChange}
            />
          ) : null}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SharedSelectorProps = Pick<
  AgentSelectorShellProps,
  "currentAgentId" | "providerId" | "onAgentChange" | "onProviderChange" | "onBeforeOpen"
>;

function CodexAgentSelector({ cwd, ...shared }: SharedSelectorProps & { cwd: string }) {
  const { settings, update } = useCodexSettings();
  const { models, loading, error, retry } = useCodexModels(cwd);
  const selected = settings.model || "default";
  const current = models.find((model) => model.id === settings.model);

  return (
    <AgentSelectorShell
      {...shared}
      iconProviderId={CODEX_INTEGRATION_ID}
      label={current?.name ?? (settings.model || "Codex default")}
      models={[
        { id: "default", name: "Codex default" },
        ...models.map((model) => ({
          id: model.id,
          name: model.name,
          keywords: [model.description],
        })),
      ]}
      selectedModelId={selected}
      onSelectModel={(value) =>
        update(getCodexModelPatch(value === "default" ? undefined : value, models, settings))
      }
      modelsStatus={{ isLoading: loading, error, onRetry: retry }}
    />
  );
}

function ApiAgentSelector({
  modelId,
  onModelChange,
  ...shared
}: SharedSelectorProps & { modelId: string; onModelChange: (modelId: string) => void }) {
  const { availableModels, currentModelName, isCustomProvider, isLoadingModels, modelFetchError } =
    useAIModelOptions(shared.providerId, modelId, onModelChange);

  return (
    <AgentSelectorShell
      {...shared}
      iconProviderId={shared.providerId}
      label={currentModelName}
      models={availableModels.map((model) => ({
        id: model.id,
        name: model.name,
        keywords: [model.id],
      }))}
      selectedModelId={modelId}
      onSelectModel={onModelChange}
      modelsStatus={{ isLoading: isLoadingModels, error: modelFetchError }}
      allowCustomModel={isCustomProvider || shared.providerId === "openrouter"}
      emptyModelsLabel={
        isCustomProvider ? "Type a model name to use it" : "No models for this provider"
      }
    />
  );
}

function AcpAgentSelector({
  options,
  onSessionConfigChange,
  ...shared
}: SharedSelectorProps & {
  options: SessionConfigOption[];
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
}) {
  const model = options.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentName = modelKind?.options.find(
    (option) => option.id === modelKind.currentValue,
  )?.name;

  return (
    <AgentSelectorShell
      {...shared}
      iconProviderId={shared.currentAgentId}
      label={currentName ?? "Model"}
      models={(modelKind?.options ?? []).map((option) => ({ id: option.id, name: option.name }))}
      selectedModelId={modelKind?.currentValue ?? ""}
      onSelectModel={(value) => {
        if (model) onSessionConfigChange(model.id, value);
      }}
      emptyModelsLabel="This agent provides models after its session connects"
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
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
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
  onProviderChange,
  onModelChange,
  onSessionConfigChange,
  onBeforeOpen,
}: ComposerAgentSelectorProps) {
  const shared = { currentAgentId, providerId, onAgentChange, onProviderChange, onBeforeOpen };

  if (currentAgentId === CODEX_INTEGRATION_ID) {
    return <CodexAgentSelector {...shared} cwd={cwd} />;
  }

  if (currentAgentId === "custom") {
    return <ApiAgentSelector {...shared} modelId={modelId} onModelChange={onModelChange} />;
  }

  return (
    <AcpAgentSelector
      {...shared}
      options={sessionConfigOptions}
      onSessionConfigChange={onSessionConfigChange}
    />
  );
}
