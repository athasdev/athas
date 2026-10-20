import { useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  ModelSection,
  useProviderModels,
} from "@/features/ai/components/selectors/model-connection-menu";
import { useConnectedModelProviders, useModelName } from "@/features/ai/hooks/use-model-providers";
import { useAgentOptions } from "@/features/ai/hooks/use-agent-options";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { getModelIconId, pickRecommendedModels } from "@/features/ai/lib/model-vendor";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
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
import { SlidersIcon } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import {
  AcpModelSubmenus,
  AthasModelSubmenu,
  CodexModelSubmenus,
  ProviderModelSubmenu,
} from "./composer-model-submenus";

/**
 * A connected provider the user is not on yet. Picking it switches to its first recommended
 * model, or its first model, so the Model row has a real choice to show right away.
 */
function ConnectedProviderOption({
  id,
  name,
  disabled,
  onSelect,
}: {
  id: string;
  name: string;
  disabled: boolean;
  onSelect: (modelId: string) => void;
}) {
  const { models, loading, error } = useProviderModels(id, "");
  const model = pickRecommendedModels(models)[0] ?? models[0];

  return (
    <DropdownMenuRadioItem
      value={id}
      disabled={disabled || !model}
      title={!model ? (error ?? (loading ? "Loading models…" : "No models available")) : name}
      onClick={() => {
        if (model) onSelect(model.id);
      }}
    >
      {loading && !model ? (
        <Spinner label={`Loading ${name} models`} compact />
      ) : (
        <ProviderIcon providerId={id} />
      )}
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </DropdownMenuRadioItem>
  );
}

interface ComposerAgentSelectorProps {
  cwd: string;
  currentAgentId: AgentType;
  providerId: string;
  modelId: string;
  sessionConfigOptions: SessionConfigOption[];
  /** The agent's session is still opening, so its models may not be all there yet. */
  isLoadingSessionConfig?: boolean;
  onAgentChange?: (agentId: AgentType) => void;
  onModelChange: (modelId: string, providerId: string) => void;
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onBeforeOpen?: () => void;
}

/**
 * The composer's model button: a short menu with a Provider row (Athas, each connected
 * provider, then agents) and a Model row for the current provider, each opening its own submenu,
 * and an Effort slider when the current model has an effort scale.
 */
export function ComposerAgentSelector({
  cwd,
  currentAgentId,
  providerId,
  modelId,
  sessionConfigOptions,
  isLoadingSessionConfig = false,
  onAgentChange,
  onModelChange,
  onSessionConfigChange,
  onBeforeOpen,
}: ComposerAgentSelectorProps) {
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const { options, isLoading, loadError, refresh } = useAgentOptions(currentAgentId);
  const { settings } = useCodexSettings();
  const isCustom = currentAgentId === "custom";
  const model = sessionConfigOptions.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  const modelKind = model?.kind.type === "select" ? model.kind : null;
  const currentAgent = options.find((option) => option.id === currentAgentId);
  const iconId = isCustom ? getModelIconId(providerId, modelId) : currentAgentId;
  const selectedModelName = useModelName(providerId, modelId);
  const isAthasAutomatic = providerId === "athas" && (!modelId || modelId === "auto");
  const label = isCustom
    ? isAthasAutomatic
      ? "Automatic"
      : selectedModelName || modelId || "Choose model"
    : currentAgentId === CODEX_INTEGRATION_ID
      ? settings.model || "Default"
      : modelKind?.options.find((option) => option.id === modelKind.currentValue)?.name ||
        currentAgent?.name ||
        currentAgentId;
  const configuredProviders = useConnectedModelProviders([providerId]);
  const isSignedIn = useAuthStore((state) => state.subscription !== null);
  const agents = options.filter(
    (option) => option.id !== "custom" && (option.isInstalled || option.isCurrent),
  );
  const currentProvider = isCustom ? providerId : currentAgentId;
  const providerName = isCustom
    ? providerId === "athas"
      ? "Athas"
      : (configuredProviders.find((provider) => provider.id === providerId)?.name ?? providerId)
    : (currentAgent?.name ?? currentAgentId);
  const canChooseApiModel = isCustom || Boolean(onAgentChange);
  const chooseProvider = (choose: () => void) => {
    setIsProviderMenuOpen(false);
    choose();
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onBeforeOpen?.();
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
          <ProviderIcon providerId={iconId} iconUrl={isCustom ? undefined : currentAgent?.icon} />
          <span className="min-w-0 truncate">{label}</span>
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="start" side="top" size="default">
        <DropdownMenuGroup>
          <DropdownMenuSub open={isProviderMenuOpen} onOpenChange={setIsProviderMenuOpen}>
            <DropdownMenuSubTrigger value={providerName}>Provider</DropdownMenuSubTrigger>
            <DropdownMenuSubContent size="default" viewport="list">
              <DropdownMenuRadioGroup value={currentProvider}>
                <DropdownMenuRadioItem
                  value="athas"
                  disabled={!canChooseApiModel}
                  onClick={() =>
                    chooseProvider(() => {
                      if (currentProvider !== "athas") onModelChange("auto", "athas");
                    })
                  }
                >
                  <ProviderIcon providerId="athas" />
                  <span className="min-w-0 flex-1 truncate">Athas</span>
                  <span className="shrink-0 text-subtle-foreground ui-text-caption">
                    {isSignedIn ? "Athas credit" : "Sign in"}
                  </span>
                </DropdownMenuRadioItem>
                {configuredProviders.length > 0 ? (
                  <DropdownMenuLabel>Your API keys</DropdownMenuLabel>
                ) : null}
                {configuredProviders.map((provider) =>
                  provider.id === currentProvider ? (
                    <DropdownMenuRadioItem
                      key={provider.id}
                      value={provider.id}
                      onClick={() => setIsProviderMenuOpen(false)}
                    >
                      <ProviderIcon providerId={provider.id} />
                      <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                    </DropdownMenuRadioItem>
                  ) : (
                    <ConnectedProviderOption
                      key={provider.id}
                      id={provider.id}
                      name={provider.name}
                      disabled={!canChooseApiModel}
                      onSelect={(id) => chooseProvider(() => onModelChange(id, provider.id))}
                    />
                  ),
                )}
              </DropdownMenuRadioGroup>
              <ModelSection
                id="agents"
                label="Agents"
                models={agents.map((agent) => ({
                  id: agent.id,
                  name: agent.name,
                  iconId: agent.id,
                  iconUrl: agent.icon,
                  disabled: !onAgentChange && !agent.isCurrent,
                }))}
                selected={isCustom ? "" : currentAgentId}
                onSelect={(id) =>
                  chooseProvider(() => {
                    if (id !== currentAgentId) onAgentChange?.(id);
                  })
                }
                providerId="custom"
                loading={isLoading}
                error={loadError}
                retry={() => void refresh()}
                closeOnClick={false}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {isCustom ? (
            providerId === "athas" ? (
              <AthasModelSubmenu
                value={label}
                selected={modelId || "auto"}
                onSelect={(id) => onModelChange(id, "athas")}
              />
            ) : (
              <ProviderModelSubmenu
                value={label}
                providerId={providerId}
                selected={modelId}
                onSelect={(id) => onModelChange(id, providerId)}
              />
            )
          ) : currentAgentId === CODEX_INTEGRATION_ID ? (
            <CodexModelSubmenus cwd={cwd} value={label} />
          ) : (
            <AcpModelSubmenus
              agentId={currentAgentId}
              agentIcon={currentAgent?.icon}
              value={label}
              options={sessionConfigOptions}
              loading={isLoadingSessionConfig}
              onChange={onSessionConfigChange}
            />
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useUIState.getState().openSettings("ai")}>
          <SlidersIcon />
          Configure models…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
