import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import type {
  CodexSkillSummary,
  CodexThreadSummary,
} from "@/features/ai/integrations/codex/codex-types";
import {
  listCodexComposerSkills,
  listCodexComposerThreads,
  startCodexComposer,
} from "@/features/ai/integrations/codex/codex-composer-catalog";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType, ChatMode } from "@/features/ai/types/ai-chat.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { openCodexThread } from "@/features/ai/lib/open-codex-thread";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  BookOpenIcon as BookOpen,
  BrainIcon as Brain,
  ClockCounterClockwiseIcon as History,
  FadersHorizontalIcon as Preferences,
  ArrowClockwiseIcon as Retry,
  SlidersHorizontalIcon as Sliders,
  SparkleIcon as Sparkles,
  WarningIcon as Warning,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";
import { getChatPreferencesModel } from "./chat-preferences-model";

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "plan", label: "Plan" },
];

type CodexCatalogStatus = "idle" | "loading" | "loading-more" | "loaded" | "error";

interface CodexThreadsState {
  status: CodexCatalogStatus;
  threads: CodexThreadSummary[];
  nextCursor: string | null;
  error: string | null;
}

interface CodexSkillsState {
  status: CodexCatalogStatus;
  skills: CodexSkillSummary[];
  skillErrors: string[];
  error: string | null;
}

const EMPTY_CODEX_THREADS_STATE: CodexThreadsState = {
  status: "idle",
  threads: [],
  nextCursor: null,
  error: null,
};

const EMPTY_CODEX_SKILLS_STATE: CodexSkillsState = {
  status: "idle",
  skills: [],
  skillErrors: [],
  error: null,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function mergeCodexThreads(
  current: CodexThreadSummary[],
  incoming: CodexThreadSummary[],
): CodexThreadSummary[] {
  const threads = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    threads.set(thread.id, thread);
  }
  return [...threads.values()];
}

function CurrentValue({ children }: { children: string }) {
  return (
    <span className="max-w-28 shrink-0 truncate text-right text-subtle-foreground">{children}</span>
  );
}

function PreferenceLabel({ children }: { children: string }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

function MenuSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <DropdownMenuSearch
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoFocus
    />
  );
}

function ProviderPreferencesSubmenu({
  currentAgentId,
  providerId,
  onAgentChange,
  onProviderChange,
}: {
  currentAgentId: AgentType;
  providerId: string;
  onAgentChange: (agentId: AgentType) => void;
  onProviderChange: (providerId: string) => void;
}) {
  const { options, installAgent } = useAgentOptions(currentAgentId);
  const providers = useAvailableProviders();
  const [query, setQuery] = useState("");
  const agentOptions = options.filter((option) => option.id !== "custom");
  const apiProviders = providers.filter((provider) => provider.id !== "custom");
  const customProvider = providers.find((provider) => provider.id === "custom");
  const filteredAgents = agentOptions.filter((option) =>
    matchesSearchQuery(query, [option.name, option.description ?? "", option.id]),
  );
  const filteredApiProviders = apiProviders.filter((provider) =>
    matchesSearchQuery(query, [provider.name, provider.id]),
  );
  const showCustom = Boolean(
    customProvider && matchesSearchQuery(query, [customProvider.name, customProvider.id]),
  );
  const currentName =
    currentAgentId === "custom"
      ? (providers.find((provider) => provider.id === providerId)?.name ?? providerId)
      : (options.find((option) => option.isCurrent)?.name ?? currentAgentId);
  const selectedValue =
    currentAgentId === "custom" ? `api:${providerId}` : `agent:${currentAgentId}`;
  const hasGroupedResults = filteredAgents.length > 0 || filteredApiProviders.length > 0;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sparkles />
        <PreferenceLabel>Provider</PreferenceLabel>
        <CurrentValue>{currentName}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search providers..." />
        <DropdownMenuRadioGroup
          value={selectedValue}
          onValueChange={(value) => {
            const [kind, id] = value.split(":", 2);
            if (!id) return;
            if (kind === "api") {
              onProviderChange(id);
              onAgentChange("custom");
              return;
            }

            const option = agentOptions.find((candidate) => candidate.id === id);
            if (!option) return;
            if (option.isInstalled) {
              onAgentChange(option.id);
              return;
            }
            if (option.canInstall) void installAgent(option.id, option.name);
          }}
        >
          {filteredAgents.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Agents</DropdownMenuLabel>
              {filteredAgents.map((option) => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={`agent:${option.id}`}
                  disabled={option.isInstalling || (!option.isInstalled && !option.canInstall)}
                  title={option.description}
                >
                  <ProviderIcon providerId={option.id} size={14} />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {!option.isInstalled ? (
                    option.isInstalling ? (
                      <Spinner label={`Installing ${option.name}`} compact />
                    ) : (
                      <span className="text-subtle-foreground ui-text-chrome">Install</span>
                    )
                  ) : option.updateAvailable ? (
                    <span className="text-subtle-foreground ui-text-chrome">Update available</span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {filteredApiProviders.length > 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>API</DropdownMenuLabel>
              {filteredApiProviders.map((provider) => (
                <DropdownMenuRadioItem key={provider.id} value={`api:${provider.id}`}>
                  <ProviderIcon providerId={provider.id} size={14} />
                  {provider.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {showCustom ? (
            <>
              {hasGroupedResults ? <DropdownMenuSeparator /> : null}
              <DropdownMenuRadioItem value="api:custom">
                <ProviderIcon providerId="custom" size={14} />
                Custom
              </DropdownMenuRadioItem>
            </>
          ) : null}
          {!hasGroupedResults && !showCustom ? (
            <DropdownMenuItem disabled>No matching providers</DropdownMenuItem>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ModePreferencesSubmenu({ currentAgentId }: { currentAgentId: AgentType }) {
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.actions.setMode);
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.actions.changeSessionMode);
  const isAcpAgent = currentAgentId !== "custom";
  const options = isAcpAgent
    ? sessionModeState.availableModes.map((option) => ({ id: option.id, label: option.name }))
    : FALLBACK_MODES;
  const selectedModeId = isAcpAgent
    ? (sessionModeState.currentModeId ?? options[0]?.id ?? "")
    : mode;
  const selectedModeName = options.find((option) => option.id === selectedModeId)?.label ?? "Mode";

  if (options.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sliders />
        <PreferenceLabel>Mode</PreferenceLabel>
        <CurrentValue>{selectedModeName}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={selectedModeId}
          onValueChange={(nextMode) => {
            if (isAcpAgent) {
              void changeSessionMode(nextMode);
              return;
            }
            setMode(nextMode as ChatMode);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function AthasAgentPreferences({
  providerId,
  modelId,
  onProviderChange,
  onModelChange,
  showProviderSelector,
}: {
  providerId: string;
  modelId: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  showProviderSelector: boolean;
}) {
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const providers = useAvailableProviders();
  const currentProvider = providers.find((provider) => provider.id === providerId);
  const { availableModels, currentModelName, isLoadingModels, modelFetchError } = useAIModelOptions(
    providerId,
    modelId,
    onModelChange,
  );
  const filteredApiProviders = providers.filter(
    (provider) =>
      provider.id !== "custom" && matchesSearchQuery(providerQuery, [provider.name, provider.id]),
  );
  const showCustom = providers.some(
    (provider) =>
      provider.id === "custom" && matchesSearchQuery(providerQuery, [provider.name, provider.id]),
  );
  const filteredModels = availableModels.filter((model) =>
    matchesSearchQuery(modelQuery, [model.name, model.id]),
  );

  return (
    <>
      {showProviderSelector ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ProviderIcon providerId={providerId} size={14} />
            <PreferenceLabel>Provider</PreferenceLabel>
            <CurrentValue>{currentProvider?.name ?? providerId}</CurrentValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            <MenuSearchInput
              value={providerQuery}
              onChange={setProviderQuery}
              placeholder="Search providers..."
            />
            <DropdownMenuRadioGroup value={providerId} onValueChange={onProviderChange}>
              {filteredApiProviders.length > 0 ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>API</DropdownMenuLabel>
                  {filteredApiProviders.map((provider) => (
                    <DropdownMenuRadioItem key={provider.id} value={provider.id}>
                      <ProviderIcon providerId={provider.id} size={14} />
                      {provider.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              ) : null}
              {showCustom ? (
                <>
                  {filteredApiProviders.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuRadioItem value="custom">
                    <ProviderIcon providerId="custom" size={14} />
                    Custom
                  </DropdownMenuRadioItem>
                </>
              ) : null}
              {filteredApiProviders.length === 0 && !showCustom ? (
                <DropdownMenuItem disabled>No matching providers</DropdownMenuItem>
              ) : null}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Brain />
          <PreferenceLabel>Model</PreferenceLabel>
          <CurrentValue>{currentModelName}</CurrentValue>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 min-w-64 overflow-y-auto">
          <MenuSearchInput
            value={modelQuery}
            onChange={setModelQuery}
            placeholder="Search models..."
          />
          {modelFetchError ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-64 text-warning">
                {modelFetchError}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          ) : null}
          {isLoadingModels ? (
            <DropdownMenuItem disabled>
              <Spinner label="Loading models" compact />
              Loading models…
            </DropdownMenuItem>
          ) : (
            <DropdownMenuRadioGroup value={modelId} onValueChange={onModelChange}>
              {filteredModels.map((model) => {
                return (
                  <DropdownMenuRadioItem key={model.id} value={model.id}>
                    <span className="min-w-0 flex-1 truncate" title={model.id}>
                      {model.name}
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
              {filteredModels.length === 0 ? (
                <DropdownMenuItem disabled>No matching models</DropdownMenuItem>
              ) : null}
            </DropdownMenuRadioGroup>
          )}
          {providerId === "custom" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
                Configure custom model…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

function SkillsPreferencesSubmenu({
  onSelectSkill,
}: {
  onSelectSkill: (skill: AIChatSkill) => void;
}) {
  const [query, setQuery] = useState("");
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const filteredSkills = skills.filter((skill) =>
    matchesSearchQuery(query, [skill.title, skill.description ?? "", skill.content]),
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <BookOpen />
        <PreferenceLabel>Skills</PreferenceLabel>
        <CurrentValue>{skills.length.toString()}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 min-w-64 overflow-y-auto">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search skills..." />
        {filteredSkills.map((skill) => (
          <DropdownMenuItem key={skill.id} onClick={() => onSelectSkill(skill)}>
            <BookOpen />
            <span className="min-w-0 flex-1 truncate">{skill.title}</span>
          </DropdownMenuItem>
        ))}
        {filteredSkills.length === 0 ? (
          <DropdownMenuItem disabled>
            {skills.length === 0 ? "No skills yet" : "No matching skills"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexCatalogError({
  label,
  message,
  onRetry,
}: {
  label: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <DropdownMenuItem disabled title={message}>
        <Warning className="text-warning" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onRetry}>
        <Retry />
        Retry
      </DropdownMenuItem>
    </>
  );
}

function CodexSessionsPreferencesSubmenu({
  state,
  onOpen,
  onRetry,
  onLoadMore,
}: {
  state: CodexThreadsState;
  onOpen: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredThreads = state.threads.filter((thread) =>
    matchesSearchQuery(query, [thread.name ?? "", thread.preview, thread.cwd]),
  );
  const count =
    state.status === "error" && state.threads.length === 0
      ? "!"
      : (state.status === "loading" || state.status === "idle") && state.threads.length === 0
        ? "…"
        : `${state.threads.length}${state.nextCursor ? "+" : ""}`;
  const hasQuery = query.trim().length > 0;
  const isInitialLoading = state.status === "loading" && state.threads.length === 0;
  const hasInitialError = state.status === "error" && state.threads.length === 0;

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          setQuery("");
        }
      }}
    >
      <DropdownMenuSubTrigger>
        <History />
        <PreferenceLabel>Sessions</PreferenceLabel>
        <CurrentValue>{count}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search sessions..." />
        {isInitialLoading || state.status === "idle" ? (
          <DropdownMenuItem disabled>
            <Spinner label="Loading sessions" compact />
            Loading sessions…
          </DropdownMenuItem>
        ) : hasInitialError ? (
          <CodexCatalogError
            label="Could not load sessions"
            message={state.error ?? "Unknown error"}
            onRetry={onRetry}
          />
        ) : state.threads.length === 0 ? (
          <DropdownMenuItem disabled>No Codex sessions yet</DropdownMenuItem>
        ) : filteredThreads.length === 0 ? (
          <DropdownMenuItem disabled>No matching sessions</DropdownMenuItem>
        ) : (
          filteredThreads.map((thread) => {
            const title = thread.name?.trim() || thread.preview.trim() || "Untitled session";
            const updatedAt = thread.updatedAt > 0 ? new Date(thread.updatedAt * 1000) : null;

            return (
              <DropdownMenuItem
                key={thread.id}
                onClick={() => openCodexThread(thread)}
                title={thread.preview || title}
              >
                <History />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {updatedAt ? (
                  <span className="shrink-0 text-subtle-foreground">
                    {updatedAt.toLocaleDateString()}
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
        {state.status === "error" && state.threads.length > 0 ? (
          <CodexCatalogError
            label="Could not load more sessions"
            message={state.error ?? "Unknown error"}
            onRetry={onRetry}
          />
        ) : null}
        {!hasQuery && state.nextCursor ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={state.status === "loading-more"}
            onClick={onLoadMore}
          >
            {state.status === "loading-more" ? (
              <Spinner label="Loading more sessions" compact />
            ) : (
              <History />
            )}
            {state.status === "loading-more" ? "Loading more…" : "Load more sessions"}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexSkillsPreferencesSubmenu({
  state,
  onOpen,
  onRetry,
  onSelectSkill,
}: {
  state: CodexSkillsState;
  onOpen: () => void;
  onRetry: () => void;
  onSelectSkill: (skill: CodexSkillSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredSkills = state.skills.filter((skill) =>
    matchesSearchQuery(query, [skill.name, skill.description, skill.path, skill.scope]),
  );
  const count =
    state.status === "error"
      ? "!"
      : state.status === "loading" || state.status === "idle"
        ? "…"
        : state.skills.length.toString();
  const hasSkillLoadError =
    state.status === "loaded" && state.skills.length === 0 && state.skillErrors.length > 0;

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          setQuery("");
        }
      }}
    >
      <DropdownMenuSubTrigger>
        <BookOpen />
        <PreferenceLabel>Skills</PreferenceLabel>
        <CurrentValue>{count}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search Codex skills..." />
        {state.status === "loading" || state.status === "idle" ? (
          <DropdownMenuItem disabled>
            <Spinner label="Loading skills" compact />
            Loading skills…
          </DropdownMenuItem>
        ) : state.status === "error" || hasSkillLoadError ? (
          <CodexCatalogError
            label="Could not load skills"
            message={state.error ?? state.skillErrors.join("\n")}
            onRetry={onRetry}
          />
        ) : state.skills.length === 0 ? (
          <DropdownMenuItem disabled>No Codex skills found</DropdownMenuItem>
        ) : filteredSkills.length === 0 ? (
          <DropdownMenuItem disabled>No matching skills</DropdownMenuItem>
        ) : (
          filteredSkills.map((skill) => (
            <DropdownMenuItem
              key={skill.path || skill.name}
              onClick={() => onSelectSkill(skill)}
              title={skill.description}
              disabled={!skill.enabled}
            >
              <BookOpen />
              <span className="min-w-0 flex-1 truncate">{skill.name}</span>
              {skill.scope ? (
                <span className="shrink-0 text-subtle-foreground">{skill.scope}</span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        {state.skills.length > 0 && state.skillErrors.length > 0 ? (
          <DropdownMenuItem disabled title={state.skillErrors.join("\n")}>
            <Warning className="text-warning" />
            Some skills could not be loaded
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function AcpConfigPreferences({
  options,
  onChange,
}: {
  options: SessionConfigOption[];
  onChange: (optionId: string, value: SessionConfigValue) => void;
}) {
  return options.map((option) => {
    if (option.kind.type === "boolean") {
      return (
        <DropdownMenuCheckboxItem
          key={option.id}
          checked={option.kind.currentValue}
          onCheckedChange={(checked) => onChange(option.id, checked)}
          title={option.description}
        >
          <Brain />
          <PreferenceLabel>{option.name}</PreferenceLabel>
        </DropdownMenuCheckboxItem>
      );
    }

    if (option.kind.options.length === 0) return null;
    const currentValue = option.kind.currentValue || option.kind.options[0]?.id || "";
    const currentName =
      option.kind.options.find((candidate) => candidate.id === currentValue)?.name ?? option.name;

    return (
      <DropdownMenuSub key={option.id}>
        <DropdownMenuSubTrigger>
          <Brain />
          <PreferenceLabel>{option.name}</PreferenceLabel>
          <CurrentValue>{currentName}</CurrentValue>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48">
          <DropdownMenuRadioGroup
            value={currentValue}
            onValueChange={(value) => onChange(option.id, value)}
          >
            {option.kind.options.map((value) => (
              <DropdownMenuRadioItem key={value.id} value={value.id} title={value.description}>
                {value.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  });
}

interface ChatPreferencesMenuProps {
  currentAgentId: AgentType;
  providerId: string;
  modelId: string;
  sessionConfigOptions: SessionConfigOption[];
  onAgentChange?: (agentId: AgentType) => void;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onSelectSkill: (skill: AIChatSkill) => void;
  onSelectCodexSkill: (skillName: string) => void;
  onBeforeOpen: () => void;
}

export function ChatPreferencesMenu({
  currentAgentId,
  providerId,
  modelId,
  sessionConfigOptions,
  onAgentChange,
  onProviderChange,
  onModelChange,
  onSessionConfigChange,
  onSelectSkill,
  onSelectCodexSkill,
  onBeforeOpen,
}: ChatPreferencesMenuProps) {
  const cwd = useProjectStore((state) => state.rootFolderPath || ".");
  const [codexThreadsState, setCodexThreadsState] =
    useState<CodexThreadsState>(EMPTY_CODEX_THREADS_STATE);
  const [codexSkillsState, setCodexSkillsState] =
    useState<CodexSkillsState>(EMPTY_CODEX_SKILLS_STATE);
  const codexStartRef = useRef<{
    cwd: string;
    token: symbol;
    promise: Promise<void>;
  } | null>(null);
  const codexThreadsRequestId = useRef(0);
  const codexSkillsRequestId = useRef(0);
  const isCodex = currentAgentId === CODEX_INTEGRATION_ID;

  const ensureCodexStarted = useCallback(() => {
    if (codexStartRef.current?.cwd === cwd) {
      return codexStartRef.current.promise;
    }

    const token = Symbol("codex-composer-start");
    const promise = startCodexComposer(cwd).catch((error) => {
      if (codexStartRef.current?.token === token) {
        codexStartRef.current = null;
      }
      throw error;
    });
    codexStartRef.current = { cwd, token, promise };
    return promise;
  }, [cwd]);

  const loadCodexThreads = useCallback(
    (append: boolean) => {
      const cursor = append ? codexThreadsState.nextCursor : null;
      if (append && !cursor) return;

      const requestId = ++codexThreadsRequestId.current;
      setCodexThreadsState((state) =>
        append
          ? { ...state, status: "loading-more", error: null }
          : { ...EMPTY_CODEX_THREADS_STATE, status: "loading" },
      );

      void ensureCodexStarted()
        .then(() => listCodexComposerThreads(cwd, cursor))
        .then((page) => {
          if (requestId !== codexThreadsRequestId.current) return;
          setCodexThreadsState((state) => ({
            status: "loaded",
            threads: append ? mergeCodexThreads(state.threads, page.threads) : page.threads,
            nextCursor: page.nextCursor,
            error: null,
          }));
        })
        .catch((error) => {
          if (requestId !== codexThreadsRequestId.current) return;
          if (codexStartRef.current?.cwd === cwd) {
            codexStartRef.current = null;
          }
          setCodexThreadsState((state) =>
            append
              ? { ...state, status: "error", error: getErrorMessage(error) }
              : {
                  ...EMPTY_CODEX_THREADS_STATE,
                  status: "error",
                  error: getErrorMessage(error),
                },
          );
        });
    },
    [codexThreadsState.nextCursor, cwd, ensureCodexStarted],
  );

  const loadCodexSkills = useCallback(() => {
    const requestId = ++codexSkillsRequestId.current;
    setCodexSkillsState({ ...EMPTY_CODEX_SKILLS_STATE, status: "loading" });

    void ensureCodexStarted()
      .then(() => listCodexComposerSkills(cwd))
      .then(({ skills, skillErrors }) => {
        if (requestId !== codexSkillsRequestId.current) return;
        setCodexSkillsState({
          status: "loaded",
          skills,
          skillErrors,
          error: null,
        });
      })
      .catch((error) => {
        if (requestId !== codexSkillsRequestId.current) return;
        if (codexStartRef.current?.cwd === cwd) {
          codexStartRef.current = null;
        }
        setCodexSkillsState({
          ...EMPTY_CODEX_SKILLS_STATE,
          status: "error",
          error: getErrorMessage(error),
        });
      });
  }, [cwd, ensureCodexStarted]);

  useEffect(() => {
    codexThreadsRequestId.current++;
    codexSkillsRequestId.current++;
    codexStartRef.current = null;
    setCodexThreadsState(EMPTY_CODEX_THREADS_STATE);
    setCodexSkillsState(EMPTY_CODEX_SKILLS_STATE);
  }, [cwd]);

  const preferences = useMemo(
    () =>
      getChatPreferencesModel({
        currentAgentId,
        canChangeAgent: Boolean(onAgentChange),
        sessionConfigOptions,
      }),
    [currentAgentId, onAgentChange, sessionConfigOptions],
  );

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        onBeforeOpen();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tooltip="AI preferences"
            aria-label="AI preferences"
          />
        }
      >
        <Preferences />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Session</DropdownMenuLabel>
          {isCodex ? (
            <CodexSessionsPreferencesSubmenu
              state={codexThreadsState}
              onOpen={() => {
                if (codexThreadsState.status === "idle") loadCodexThreads(false);
              }}
              onRetry={() => loadCodexThreads(codexThreadsState.threads.length > 0)}
              onLoadMore={() => loadCodexThreads(true)}
            />
          ) : null}
          {preferences.showAgentPreference && onAgentChange ? (
            <ProviderPreferencesSubmenu
              currentAgentId={currentAgentId}
              providerId={providerId}
              onAgentChange={onAgentChange}
              onProviderChange={onProviderChange}
            />
          ) : null}
          {preferences.showAthasAgentPreferences ? (
            <AthasAgentPreferences
              providerId={providerId}
              modelId={modelId}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
              showProviderSelector={!preferences.showAgentPreference}
            />
          ) : (
            <AcpConfigPreferences
              options={preferences.acpConfigOptions}
              onChange={onSessionConfigChange}
            />
          )}
          {preferences.showModePreference && (
            <ModePreferencesSubmenu currentAgentId={currentAgentId} />
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Instructions</DropdownMenuLabel>
          {isCodex ? (
            <CodexSkillsPreferencesSubmenu
              state={codexSkillsState}
              onOpen={() => {
                if (codexSkillsState.status === "idle") loadCodexSkills();
              }}
              onRetry={loadCodexSkills}
              onSelectSkill={(skill) => onSelectCodexSkill(skill.name)}
            />
          ) : (
            <SkillsPreferencesSubmenu onSelectSkill={onSelectSkill} />
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
            <Preferences />
            AI settings…
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
