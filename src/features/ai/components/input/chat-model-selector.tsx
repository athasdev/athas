import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import { Button } from "@/ui/button";
import Select from "@/ui/select";
import { Spinner } from "@/ui/spinner";

export function CodexModelSelector({ cwd, onOpen }: { cwd: string; onOpen?: () => void }) {
  const { settings, update } = useCodexSettings();
  const { models, loading, error, retry } = useCodexModels(cwd);
  const current = models.find((model) =>
    settings.model ? model.id === settings.model : model.isDefault,
  );
  return (
    <>
      <Select
        aria-label="Change model"
        tooltip="Change Codex model for the next message"
        variant="ghost"
        className="shrink max-w-52"
        leftIcon={<ProviderIcon providerId="codex" />}
        value={settings.model || "default"}
        options={[
          { value: "default", label: "Codex default" },
          ...models.map((model) => ({
            value: model.id,
            label: model.name,
            keywords: [model.description],
          })),
        ]}
        onChange={(value) => {
          update(getCodexModelPatch(value === "default" ? undefined : value, models, settings));
        }}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
        searchable
        menuWidth="content"
        openDirection="up"
        menuHeader={
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            {loading ? (
              <Spinner compact label="Loading models" />
            ) : (
              <span className="ui-text-chrome text-subtle-foreground" title={error ?? undefined}>
                {error ? "Could not load models" : "Model"}
              </span>
            )}
            <Button variant="ghost" disabled={loading} onClick={retry}>
              {error ? "Retry" : "Refresh"}
            </Button>
          </div>
        }
      />
      {current && current.reasoningEfforts.length > 0 ? (
        <Select
          aria-label="Reasoning effort"
          tooltip="Reasoning effort for the next message"
          variant="ghost"
          className="shrink max-w-24"
          value={settings.effort || current.defaultReasoningEffort}
          options={current.reasoningEfforts.map(({ value, label }) => ({
            value,
            label: value,
            keywords: [label],
          }))}
          onChange={(effort) => update({ effort })}
          onOpenChange={(open) => {
            if (open) onOpen?.();
          }}
          menuWidth="content"
          openDirection="up"
        />
      ) : null}
    </>
  );
}

export function AcpModelSelector({
  agentId,
  options,
  onChange,
}: {
  agentId: string;
  options: SessionConfigOption[];
  onChange: (id: string, value: SessionConfigValue) => void;
}) {
  const model = options.find(
    (option) => classifySessionConfigOption(option) === "model" && option.kind.type === "select",
  );
  if (!model || model.kind.type !== "select")
    return (
      <Button
        variant="ghost"
        disabled
        tooltip="This agent provides model choices after its session connects"
      >
        <ProviderIcon providerId={agentId} />
        Model
      </Button>
    );
  return (
    <Select
      aria-label="Change model"
      tooltip="Change model"
      variant="ghost"
      className="shrink max-w-52"
      leftIcon={<ProviderIcon providerId={agentId} />}
      value={model.kind.currentValue}
      options={model.kind.options.map((option) => ({ value: option.id, label: option.name }))}
      onChange={(value) => onChange(model.id, value)}
      searchable
      menuWidth="content"
      openDirection="up"
    />
  );
}
