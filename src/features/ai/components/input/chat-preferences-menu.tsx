import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodexSkillSummary } from "@/features/ai/integrations/codex/codex-types";
import {
  listCodexComposerSkills,
  startCodexComposer,
} from "@/features/ai/integrations/codex/codex-composer-catalog";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType, ChatMode } from "@/features/ai/types/ai-chat.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
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
  DropdownMenuEmpty,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuViewport,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { useMenuSearch } from "@/ui/menu-search";
import { ArrowClockwiseIcon, SlidersIcon, WarningIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { getChatPreferencesModel } from "@/features/ai/utils/chat-preferences-model";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "plan", label: "Plan" },
];

type CodexCatalogStatus = "idle" | "loading" | "loading-more" | "loaded" | "error";

interface CodexSkillsState {
  status: CodexCatalogStatus;
  skills: CodexSkillSummary[];
  skillErrors: string[];
  error: string | null;
}

const EMPTY_CODEX_SKILLS_STATE: CodexSkillsState = {
  status: "idle",
  skills: [],
  skillErrors: [],
  error: null,
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function CurrentValue({ children }: { children: string }) {
  return (
    <span className="max-w-28 shrink-0 truncate text-right text-subtle-foreground">{children}</span>
  );
}

function PreferenceLabel({ children }: { children: string }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
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
  const search = useMenuSearch();
  const skills = useSettingsStore((state) => state.settings.aiSkills);
  const filteredSkills = search.filter(skills, (skill) => [
    skill.title,
    skill.description ?? "",
    skill.content,
  ]);

  return (
    <DropdownMenuSub onOpenChange={(open) => !open && search.reset()}>
      <DropdownMenuSubTrigger>
        <PreferenceLabel>Skills</PreferenceLabel>
        {skills.length > 0 ? <CurrentValue>{String(skills.length)}</CurrentValue> : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent size="wide" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search skills..."
          autoFocus
        />
        <DropdownMenuViewport>
          {filteredSkills.map((skill) => (
            <DropdownMenuItem key={skill.id} onClick={() => onSelectSkill(skill)}>
              <span className="min-w-0 flex-1 truncate">{skill.title}</span>
            </DropdownMenuItem>
          ))}
          {filteredSkills.length === 0 ? (
            <DropdownMenuEmpty>
              {skills.length === 0 ? "No skills yet" : "No matching skills"}
            </DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
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
  const search = useMenuSearch();
  const filteredSkills = search.filter(state.skills, (skill) => [
    skill.name,
    skill.description,
    skill.path,
    skill.scope,
  ]);
  const hasSkillLoadError =
    state.status === "loaded" && state.skills.length === 0 && state.skillErrors.length > 0;

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        } else {
          search.reset();
        }
      }}
    >
      <DropdownMenuSubTrigger>
        <PreferenceLabel>Skills</PreferenceLabel>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent size="wide" viewport="searchable">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Search Codex skills..."
          autoFocus
        />
        <DropdownMenuViewport>
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
            <DropdownMenuEmpty>No Codex skills found</DropdownMenuEmpty>
          ) : filteredSkills.length === 0 ? (
            <DropdownMenuEmpty>No matching skills</DropdownMenuEmpty>
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
        </DropdownMenuViewport>
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
        <DropdownMenuSubContent size="default">
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
  const [codexSkillsState, setCodexSkillsState] =
    useState<CodexSkillsState>(EMPTY_CODEX_SKILLS_STATE);
  const codexStartRef = useRef<{
    cwd: string;
    token: symbol;
    promise: Promise<void>;
  } | null>(null);
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
    codexSkillsRequestId.current++;
    codexStartRef.current = null;
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
      <DropdownMenuContent align="start" side="top" size="wide">
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
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
          AI settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
