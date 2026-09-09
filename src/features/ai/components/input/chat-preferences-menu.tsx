import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ArrowClockwiseIcon, SlidersIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";
import { getChatPreferencesModel } from "@/features/ai/utils/chat-preferences-model";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";

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

function ModePreferencesSubmenu({ currentAgentId }: { currentAgentId: AgentType }) {
  const { settings: codexSettings, update: updateCodexSettings } = useCodexSettings();
  const isCodex = currentAgentId === CODEX_INTEGRATION_ID;
  const mode = useAIChatStore((state) => state.mode);
  const setMode = useAIChatStore((state) => state.actions.setMode);
  const sessionModeState = useAIChatStore((state) => state.sessionModeState);
  const changeSessionMode = useAIChatStore((state) => state.actions.changeSessionMode);
  const isAcpAgent = currentAgentId !== "custom" && !isCodex;
  const options = isCodex
    ? [
        { id: "default", label: "Agent" },
        { id: "plan", label: "Plan" },
      ]
    : isAcpAgent
      ? sessionModeState.availableModes.map((option) => ({ id: option.id, label: option.name }))
      : FALLBACK_MODES;
  const selectedModeId = isCodex
    ? (codexSettings.collaborationMode ?? "default")
    : isAcpAgent
      ? (sessionModeState.currentModeId ?? options[0]?.id ?? "")
      : mode;
  const selectedModeName = options.find((option) => option.id === selectedModeId)?.label ?? "Mode";

  if (options.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PreferenceLabel>Mode</PreferenceLabel>
        <CurrentValue>{selectedModeName}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={selectedModeId}
          onValueChange={(nextMode) => {
            if (isCodex) {
              updateCodexSettings({ collaborationMode: nextMode });
              return;
            }
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

function SkillsSubmenu({ onSelectSkill }: { onSelectSkill: (skill: AIChatSkill) => void }) {
  const [query, setQuery] = useState("");
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const filteredSkills = skills.filter((skill) =>
    matchesSearchQuery(query, [skill.title, skill.description ?? "", skill.content]),
  );

  return (
    <DropdownMenuSub onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuSubTrigger>
        <PreferenceLabel>Skills</PreferenceLabel>
        {skills.length > 0 ? <CurrentValue>{String(skills.length)}</CurrentValue> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 min-w-64 overflow-y-auto">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search skills..." />
        {filteredSkills.map((skill) => (
          <DropdownMenuItem key={skill.id} onClick={() => onSelectSkill(skill)}>
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
        <WarningIcon className="text-warning" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </DropdownMenuItem>
      <DropdownMenuItem closeOnClick={false} onClick={onRetry}>
        <ArrowClockwiseIcon />
        Retry
      </DropdownMenuItem>
    </>
  );
}

function CodexSessionsSubmenu({
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
        <PreferenceLabel>Sessions</PreferenceLabel>
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
            ) : null}
            {state.status === "loading-more" ? "Loading more…" : "Load more sessions"}
          </DropdownMenuItem>
        ) : null}
        {state.status !== "error" ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={state.status === "loading" || state.status === "loading-more"}
            onClick={onRetry}
          >
            <ArrowClockwiseIcon />
            Refresh sessions
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexSkillsSubmenu({
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
        <PreferenceLabel>Skills</PreferenceLabel>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search Codex skills..." />
        {(state.status === "loading" || state.status === "idle") && state.skills.length === 0 ? (
          <DropdownMenuItem disabled>
            <Spinner label="Loading skills" compact />
            Loading skills…
          </DropdownMenuItem>
        ) : (state.status === "error" && state.skills.length === 0) || hasSkillLoadError ? (
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
              <span className="min-w-0 flex-1 truncate">{skill.name}</span>
              {skill.scope ? (
                <span className="shrink-0 text-subtle-foreground">{skill.scope}</span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        {state.skills.length > 0 && state.skillErrors.length > 0 ? (
          <DropdownMenuItem disabled title={state.skillErrors.join("\n")}>
            <WarningIcon className="text-warning" />
            Some skills could not be loaded
          </DropdownMenuItem>
        ) : null}
        {state.status === "error" && state.skills.length > 0 ? (
          <CodexCatalogError
            label="Could not refresh skills"
            message={state.error ?? "Unknown error"}
            onRetry={onRetry}
          />
        ) : null}
        {state.status !== "error" ? (
          <DropdownMenuItem
            closeOnClick={false}
            disabled={state.status === "loading"}
            onClick={onRetry}
          >
            <ArrowClockwiseIcon />
            Refresh skills
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
  canChangeAgent: boolean;
  sessionConfigOptions: SessionConfigOption[];
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onSelectSkill: (skill: AIChatSkill) => void;
  onSelectCodexSkill: (skillName: string) => void;
  onBeforeOpen: () => void;
}

export function ChatPreferencesMenu({
  currentAgentId,
  canChangeAgent,
  sessionConfigOptions,
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
    (append: boolean, force = false) => {
      const cursor = append ? codexThreadsState.nextCursor : null;
      if (append && !cursor) return;

      const requestId = ++codexThreadsRequestId.current;
      setCodexThreadsState((state) =>
        append
          ? { ...state, status: "loading-more", error: null }
          : { ...state, status: "loading", error: null },
      );

      void ensureCodexStarted()
        .then(() => listCodexComposerThreads(cwd, cursor, force))
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
          setCodexThreadsState((state) => ({
            ...state,
            status: "error",
            error: getErrorMessage(error),
          }));
        });
    },
    [codexThreadsState.nextCursor, cwd, ensureCodexStarted],
  );

  const loadCodexSkills = useCallback(
    (force = false) => {
      const requestId = ++codexSkillsRequestId.current;
      setCodexSkillsState((state) => ({ ...state, status: "loading", error: null }));

      void ensureCodexStarted()
        .then(() => listCodexComposerSkills(cwd, force))
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
          setCodexSkillsState((state) => ({
            ...state,
            status: "error",
            error: getErrorMessage(error),
          }));
        });
    },
    [cwd, ensureCodexStarted],
  );

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
        canChangeAgent,
        sessionConfigOptions,
      }),
    [canChangeAgent, currentAgentId, sessionConfigOptions],
  );

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onBeforeOpen();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            tooltip="Agent settings"
            aria-label="AI preferences"
          />
        }
      >
        <SlidersIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-64">
        <DropdownMenuGroup>
          {isCodex ? null : (
            <AcpConfigPreferences
              options={preferences.acpConfigOptions.filter((option) => {
                const category = classifySessionConfigOption(option);
                // Model and effort each have a dedicated composer control.
                return category !== "model" && category !== "thought_level";
              })}
              onChange={onSessionConfigChange}
            />
          )}
          {preferences.showModePreference && (
            <ModePreferencesSubmenu currentAgentId={currentAgentId} />
          )}
          {isCodex ? (
            <CodexSkillsSubmenu
              state={codexSkillsState}
              onOpen={() => {
                if (codexSkillsState.status === "idle") loadCodexSkills();
              }}
              onRetry={() => loadCodexSkills(true)}
              onSelectSkill={(skill) => onSelectCodexSkill(skill.name)}
            />
          ) : (
            <SkillsSubmenu onSelectSkill={onSelectSkill} />
          )}
          {isCodex ? (
            <CodexSessionsSubmenu
              state={codexThreadsState}
              onOpen={() => {
                if (codexThreadsState.status === "idle") loadCodexThreads(false);
              }}
              onRetry={() => loadCodexThreads(false, true)}
              onLoadMore={() => loadCodexThreads(true)}
            />
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
          AI settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
