import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { Button } from "@/ui/button";
import { ArrowCounterClockwiseIcon, BoltIcon, ChevronDownIcon } from "@/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Slider } from "@/ui/slider";

interface EffortStep {
  value: string;
  label: string;
  description?: string;
}

/**
 * Every agent that exposes an ordered "how hard should it think" scale gets the
 * same stepped slider: Codex reasoning efforts and the ACP `thought_level`
 * session config both land here.
 */
function EffortPopover({
  steps,
  selectedIndex,
  onSelectIndex,
  defaultIndex,
  context,
  onOpen,
}: {
  steps: EffortStep[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  defaultIndex?: number;
  /** Secondary line under the value — the model or option this scale belongs to. */
  context?: string;
  onOpen?: () => void;
}) {
  const selected = steps[selectedIndex];
  const canReset = defaultIndex !== undefined && defaultIndex !== selectedIndex;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            capitalize
            truncate
            aria-label="Reasoning effort"
            tooltip="Reasoning effort for the next message"
          />
        }
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDownIcon className="text-subtle-foreground" />
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-64 gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <BoltIcon className="size-3.5 shrink-0 text-subtle-foreground" />
          <div className="min-w-0 flex-1 text-center">
            <div
              className="truncate font-medium text-primary capitalize ui-text-base"
              title={selected?.description}
            >
              {selected?.label}
            </div>
            {context ? (
              <div className="truncate text-subtle-foreground ui-text-sm" title={context}>
                {context}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            iconOnly
            size="compact"
            disabled={!canReset}
            onClick={() => defaultIndex !== undefined && onSelectIndex(defaultIndex)}
            aria-label="Reset reasoning effort"
            tooltip={canReset ? `Reset to ${steps[defaultIndex]?.label}` : undefined}
          >
            <ArrowCounterClockwiseIcon />
          </Button>
        </div>

        <Slider
          value={selectedIndex}
          onValueChange={onSelectIndex}
          max={steps.length - 1}
          ticks
          aria-label="Reasoning effort"
        />
      </PopoverContent>
    </Popover>
  );
}

function CodexEffortSelector({ cwd, onOpen }: { cwd: string; onOpen?: () => void }) {
  const { settings, update } = useCodexSettings();
  const { models } = useCodexModels(cwd);
  const current = models.find((model) =>
    settings.model ? model.id === settings.model : model.isDefault,
  );
  const efforts = current?.reasoningEfforts ?? [];

  if (!current || efforts.length < 2) return null;

  const steps: EffortStep[] = efforts.map((effort) => ({
    value: effort.value,
    label: effort.value,
    description: effort.label,
  }));
  const indexOf = (value: string) => steps.findIndex((step) => step.value === value);
  const defaultIndex = indexOf(current.defaultReasoningEffort);
  const selectedIndex = Math.max(
    0,
    settings.effort ? indexOf(settings.effort) : Math.max(defaultIndex, 0),
  );

  return (
    <EffortPopover
      steps={steps}
      selectedIndex={selectedIndex}
      defaultIndex={defaultIndex >= 0 ? defaultIndex : undefined}
      context={current.name}
      onSelectIndex={(index) => {
        const effort = steps[index];
        if (!effort) return;
        update(getCodexModelPatch(settings.model, models, { ...settings, effort: effort.value }));
      }}
      onOpen={onOpen}
    />
  );
}

function AcpEffortSelector({
  options,
  onChange,
  onOpen,
}: {
  options: SessionConfigOption[];
  onChange: (optionId: string, value: SessionConfigValue) => void;
  onOpen?: () => void;
}) {
  const option = options.find(
    (candidate) =>
      classifySessionConfigOption(candidate) === "thought_level" &&
      candidate.kind.type === "select",
  );
  const kind = option?.kind.type === "select" ? option.kind : null;

  if (!option || !kind || kind.options.length < 2) return null;

  const steps: EffortStep[] = kind.options.map((value) => ({
    value: value.id,
    label: value.name,
    description: value.description,
  }));
  const selectedIndex = Math.max(
    0,
    steps.findIndex((step) => step.value === kind.currentValue),
  );

  return (
    <EffortPopover
      steps={steps}
      selectedIndex={selectedIndex}
      context={option.name}
      onSelectIndex={(index) => {
        const step = steps[index];
        if (step) onChange(option.id, step.value);
      }}
      onOpen={onOpen}
    />
  );
}

export function ComposerEffortSelector({
  cwd,
  currentAgentId,
  sessionConfigOptions,
  onSessionConfigChange,
  onOpen,
}: {
  cwd: string;
  currentAgentId: AgentType;
  sessionConfigOptions: SessionConfigOption[];
  onSessionConfigChange: (optionId: string, value: SessionConfigValue) => void;
  onOpen?: () => void;
}) {
  if (currentAgentId === CODEX_INTEGRATION_ID) {
    return <CodexEffortSelector cwd={cwd} onOpen={onOpen} />;
  }

  if (currentAgentId === "custom") return null;

  return (
    <AcpEffortSelector
      options={sessionConfigOptions}
      onChange={onSessionConfigChange}
      onOpen={onOpen}
    />
  );
}
