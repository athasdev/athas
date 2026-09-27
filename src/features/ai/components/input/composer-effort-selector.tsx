import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/ui/dropdown";

interface EffortStep {
  value: string;
  label: string;
  description?: string;
}

/**
 * Every agent that exposes an ordered "how hard should it think" scale gets the same submenu
 * in the model menu: Codex reasoning efforts and the ACP `thought_level` session config both
 * land here.
 */
function EffortSubmenu({
  steps,
  selected,
  defaultValue,
  onSelect,
}: {
  steps: EffortStep[];
  selected: string;
  defaultValue?: string;
  onSelect: (value: string) => void;
}) {
  const current = steps.find((step) => step.value === selected) ?? steps[0];

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="min-w-0 flex-1 truncate">Reasoning effort</span>
        <span className="max-w-28 shrink-0 truncate text-subtle-foreground capitalize">
          {current?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent size="compact">
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
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexEffortSubmenu({ cwd }: { cwd: string }) {
  const { settings, update } = useCodexSettings();
  const { models } = useCodexModels(cwd);
  const current = models.find((model) =>
    settings.model ? model.id === settings.model : model.isDefault,
  );
  const efforts = current?.reasoningEfforts ?? [];

  if (!current || efforts.length < 2) return null;

  return (
    <EffortSubmenu
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

function AcpEffortSubmenu({
  options,
  onChange,
}: {
  options: SessionConfigOption[];
  onChange: (optionId: string, value: SessionConfigValue) => void;
}) {
  const option = options.find(
    (candidate) =>
      classifySessionConfigOption(candidate) === "thought_level" &&
      candidate.kind.type === "select",
  );
  const kind = option?.kind.type === "select" ? option.kind : null;

  if (!option || !kind || kind.options.length < 2) return null;

  return (
    <EffortSubmenu
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

export function ComposerEffortSubmenu({
  cwd,
  currentAgentId,
  sessionConfigOptions,
  onSessionConfigChange,
}: {
  cwd: string;
  currentAgentId: AgentType;
  sessionConfigOptions: SessionConfigOption[];
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
}) {
  if (currentAgentId === CODEX_INTEGRATION_ID) return <CodexEffortSubmenu cwd={cwd} />;
  if (currentAgentId === "custom") return null;
  return <AcpEffortSubmenu options={sessionConfigOptions} onChange={onSessionConfigChange} />;
}
