import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { BrainIcon } from "@/ui/icons";

interface EffortStep {
  value: string;
  label: string;
  description?: string;
}

/**
 * Every agent that exposes an ordered "how hard should it think" scale gets the same compact
 * chip beside the model button: Codex reasoning efforts and the ACP `thought_level` session
 * config both land here, and the chip hides when the current model has no scale.
 */
function EffortMenu({
  steps,
  selected,
  defaultValue,
  onSelect,
  onBeforeOpen,
}: {
  steps: EffortStep[];
  selected: string;
  defaultValue?: string;
  onSelect: (value: string) => void;
  onBeforeOpen?: () => void;
}) {
  const current = steps.find((step) => step.value === selected) ?? steps[0];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onBeforeOpen?.();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            truncate
            aria-label={`Reasoning effort: ${current?.label ?? ""}`}
            tooltip="Reasoning effort"
          />
        }
      >
        <BrainIcon />
        <span className="min-w-0 truncate capitalize">{current?.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" size="compact">
        <DropdownMenuRadioGroup value={current?.value ?? ""} onValueChange={onSelect}>
          {steps.map((step) => (
            <DropdownMenuRadioItem
              key={step.value}
              value={step.value}
              title={step.description}
              closeOnClick
            >
              <span className="min-w-0 flex-1 truncate capitalize">{step.label}</span>
              {step.value === defaultValue ? (
                <span className="shrink-0 text-subtle-foreground">Default</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CodexEffortMenu({ cwd, onBeforeOpen }: { cwd: string; onBeforeOpen?: () => void }) {
  const { settings, update } = useCodexSettings();
  const { models } = useCodexModels(cwd);
  const current = models.find((model) =>
    settings.model ? model.id === settings.model : model.isDefault,
  );
  const efforts = current?.reasoningEfforts ?? [];

  if (!current || efforts.length < 2) return null;

  return (
    <EffortMenu
      onBeforeOpen={onBeforeOpen}
      steps={efforts.map((effort) => ({
        value: effort.value,
        label: effort.value,
        description: effort.label,
      }))}
      selected={settings.effort || current.defaultReasoningEffort}
      defaultValue={current.defaultReasoningEffort}
      onSelect={(effort) =>
        update(getCodexModelPatch(settings.model, models, { ...settings, effort }))
      }
    />
  );
}

function AcpEffortMenu({
  options,
  onChange,
  onBeforeOpen,
}: {
  options: SessionConfigOption[];
  onChange: (optionId: string, value: SessionConfigValue) => void;
  onBeforeOpen?: () => void;
}) {
  const option = options.find(
    (candidate) =>
      classifySessionConfigOption(candidate) === "thought_level" &&
      candidate.kind.type === "select",
  );
  const kind = option?.kind.type === "select" ? option.kind : null;

  if (!option || !kind || kind.options.length < 2) return null;

  return (
    <EffortMenu
      onBeforeOpen={onBeforeOpen}
      steps={kind.options.map((value) => ({
        value: value.id,
        label: value.name,
        description: value.description,
      }))}
      selected={kind.currentValue}
      onSelect={(value) => onChange(option.id, value)}
    />
  );
}

export function ComposerEffortSelector({
  cwd,
  currentAgentId,
  sessionConfigOptions,
  onSessionConfigChange,
  onBeforeOpen,
}: {
  cwd: string;
  currentAgentId: AgentType;
  sessionConfigOptions: SessionConfigOption[];
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onBeforeOpen?: () => void;
}) {
  if (currentAgentId === CODEX_INTEGRATION_ID)
    return <CodexEffortMenu cwd={cwd} onBeforeOpen={onBeforeOpen} />;
  if (currentAgentId === "custom") return null;
  return (
    <AcpEffortMenu
      options={sessionConfigOptions}
      onChange={onSessionConfigChange}
      onBeforeOpen={onBeforeOpen}
    />
  );
}
