import { useMemo, useState } from "react";
import { ProBadge } from "@/features/window/components/pro-badge";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import type { SessionConfigOption } from "@/features/ai/types/acp.types";
import type { AgentType, ChatMode } from "@/features/ai/types/ai-chat.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
  FadersHorizontalIcon as Preferences,
  LockIcon as Lock,
  SlidersHorizontalIcon as Sliders,
  SparkleIcon as Sparkles,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { matchesSearchQuery } from "@/utils/search-match";
import { getChatPreferencesModel } from "./chat-preferences-model";

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "plan", label: "Plan" },
];

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

function AgentPreferencesSubmenu({
  currentAgentId,
  onAgentChange,
}: {
  currentAgentId: AgentType;
  onAgentChange: (agentId: AgentType) => void;
}) {
  const { options, installAgent } = useAgentOptions(currentAgentId);
  const [query, setQuery] = useState("");
  const currentAgentName = options.find((option) => option.isCurrent)?.name ?? "Agent";
  const filteredOptions = options.filter((option) =>
    matchesSearchQuery(query, [option.name, option.description ?? "", option.id]),
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sparkles />
        <PreferenceLabel>Agent</PreferenceLabel>
        <CurrentValue>{currentAgentName}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <MenuSearchInput value={query} onChange={setQuery} placeholder="Search agents..." />
        <DropdownMenuRadioGroup
          value={currentAgentId}
          onValueChange={(agentId) => {
            const option = options.find((candidate) => candidate.id === agentId);
            if (!option) return;
            if (option.isInstalled || option.id === "custom") {
              onAgentChange(option.id);
              return;
            }
            if (option.canInstall) void installAgent(option.id, option.name);
          }}
        >
          {filteredOptions.map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              disabled={option.isInstalling || (!option.isInstalled && !option.canInstall)}
              title={option.description}
            >
              <ProviderIcon providerId={option.id} size={14} />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {!option.isInstalled ? (
                option.isInstalling ? (
                  <Spinner label={`Installing ${option.name}`} compact />
                ) : (
                  <span className="text-subtle-foreground ui-text-sm">Install</span>
                )
              ) : null}
            </DropdownMenuRadioItem>
          ))}
          {filteredOptions.length === 0 ? (
            <DropdownMenuItem disabled>No matching agents</DropdownMenuItem>
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
}: {
  providerId: string;
  modelId: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
}) {
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const providers = useAvailableProviders();
  const currentProvider = providers.find((provider) => provider.id === providerId);
  const { availableModels, currentModelName, hasHostedAi, isLoadingModels, modelFetchError } =
    useAIModelOptions(providerId, modelId, onModelChange);
  const filteredProviders = providers.filter((provider) =>
    matchesSearchQuery(providerQuery, [provider.name, provider.id]),
  );
  const filteredModels = availableModels.filter((model) =>
    matchesSearchQuery(modelQuery, [model.name, model.id]),
  );

  return (
    <>
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
            {filteredProviders.map((provider) => (
              <DropdownMenuRadioItem key={provider.id} value={provider.id}>
                <ProviderIcon providerId={provider.id} size={14} />
                {provider.name}
              </DropdownMenuRadioItem>
            ))}
            {filteredProviders.length === 0 ? (
              <DropdownMenuItem disabled>No matching providers</DropdownMenuItem>
            ) : null}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

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
                const locked = Boolean(model.proOnly && !hasHostedAi);
                return (
                  <DropdownMenuRadioItem key={model.id} value={model.id} disabled={locked}>
                    {locked ? <Lock /> : null}
                    <span className="min-w-0 flex-1 truncate" title={model.id}>
                      {model.name}
                    </span>
                    {model.proOnly ? <ProBadge /> : null}
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

function AcpConfigPreferences({
  options,
  onChange,
}: {
  options: SessionConfigOption[];
  onChange: (optionId: string, value: string) => void;
}) {
  return options.map((option) => {
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
  onSessionConfigChange: (optionId: string, value: string) => void;
  onSelectSkill: (skill: AIChatSkill) => void;
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
  onBeforeOpen,
}: ChatPreferencesMenuProps) {
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
    <DropdownMenu onOpenChange={(open) => open && onBeforeOpen()}>
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
          {preferences.showAgentPreference && onAgentChange ? (
            <AgentPreferencesSubmenu
              currentAgentId={currentAgentId}
              onAgentChange={onAgentChange}
            />
          ) : null}
          {preferences.showAthasAgentPreferences ? (
            <AthasAgentPreferences
              providerId={providerId}
              modelId={modelId}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
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
          <SkillsPreferencesSubmenu onSelectSkill={onSelectSkill} />
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
