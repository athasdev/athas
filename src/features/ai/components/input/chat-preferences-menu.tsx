import { useMemo } from "react";
import { ProBadge } from "@/extensions/ui/components/pro-badge";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import type { SessionConfigOption } from "@/features/ai/types/acp.types";
import type { AgentType, ChatMode } from "@/features/ai/types/ai-chat.types";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
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
  KeyIcon as Key,
  LockIcon as Lock,
  SlidersHorizontalIcon as Sliders,
  SparkleIcon as Sparkles,
} from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { getChatPreferencesModel } from "./chat-preferences-model";

const FALLBACK_MODES: { id: ChatMode; label: string }[] = [
  { id: "chat", label: "Ask" },
  { id: "plan", label: "Plan" },
];

function CurrentValue({ children }: { children: string }) {
  return (
    <span className="ml-auto max-w-28 truncate text-subtle-foreground ui-text-sm">{children}</span>
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
  const currentAgentName = options.find((option) => option.isCurrent)?.name ?? "Agent";

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sparkles />
        Agent
        <CurrentValue>{currentAgentName}</CurrentValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
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
          {options.map((option) => (
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
        Mode
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
  onManageApiKeys,
}: {
  providerId: string;
  modelId: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onManageApiKeys: () => void;
}) {
  const providers = useAvailableProviders();
  const currentProvider = providers.find((provider) => provider.id === providerId);
  const { availableModels, currentModelName, hasHostedAi, modelFetchError } = useAIModelOptions(
    providerId,
    modelId,
    onModelChange,
  );

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ProviderIcon providerId={providerId} size={14} />
          Provider
          <CurrentValue>{currentProvider?.name ?? providerId}</CurrentValue>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-48">
          <DropdownMenuRadioGroup value={providerId} onValueChange={onProviderChange}>
            {providers.map((provider) => (
              <DropdownMenuRadioItem key={provider.id} value={provider.id}>
                <ProviderIcon providerId={provider.id} size={14} />
                {provider.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Brain />
          Model
          <CurrentValue>{currentModelName}</CurrentValue>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 min-w-64 overflow-y-auto">
          {modelFetchError ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="max-w-64 text-warning">
                {modelFetchError}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          ) : null}
          <DropdownMenuRadioGroup value={modelId} onValueChange={onModelChange}>
            {availableModels.map((model) => {
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
          </DropdownMenuRadioGroup>
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

      <DropdownMenuItem onClick={onManageApiKeys}>
        <Key />
        API Keys
      </DropdownMenuItem>
    </>
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
          {option.name}
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
  onManageApiKeys: () => void;
  onManageSkills: () => void;
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
  onManageApiKeys,
  onManageSkills,
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
      <DropdownMenuContent align="end" side="top" className="min-w-60">
        <DropdownMenuGroup>
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
              onManageApiKeys={onManageApiKeys}
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
          <DropdownMenuItem onClick={onManageSkills}>
            <BookOpen />
            Skills
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => useUIState.getState().openSettingsDialog("ai")}>
            <Preferences />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
