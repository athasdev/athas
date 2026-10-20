import {
  type ModelOption,
  ModelResultsProvider,
  ModelSection,
  useAthasModels,
  useModelSearchResults,
  useProviderModels,
} from "@/features/ai/components/selectors/model-connection-menu";
import { getCodexModelPatch } from "@/features/ai/integrations/codex/codex-model-settings";
import { useCodexModels } from "@/features/ai/integrations/codex/use-codex-models";
import { useCodexSettings } from "@/features/ai/integrations/codex/use-codex-settings";
import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { formatEffortLabel, isAutoEffort } from "@/features/ai/lib/effort-levels";
import { classifySessionConfigOption } from "@/features/ai/lib/session-config-option-classifier";
import type { SessionConfigOption, SessionConfigValue } from "@/features/ai/types/acp.types";
import {
  DropdownMenuEmpty,
  DropdownMenuSearch,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { useMenuSearch } from "@/ui/menu-search";
import { StepSlider } from "@/ui/step-slider";

/** Longer model lists get a search box and, when the catalog has them, recommended picks. */
const SHORT_MODEL_LIST_LENGTH = 8;

interface ModelSubmenuProps {
  value: string;
  models: ModelOption[];
  recommended?: ModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** Icon fallback for rows whose id names no known vendor. */
  providerId: string;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
}

function ModelSubmenu({
  value,
  models,
  recommended = [],
  selected,
  onSelect,
  providerId,
  loading,
  error,
  retry,
}: ModelSubmenuProps) {
  const search = useMenuSearch();
  const { reportResults, hasNoResults } = useModelSearchResults();
  const isLong = models.length > SHORT_MODEL_LIST_LENGTH;
  const picks = isLong && !search.isSearching ? recommended : [];
  const isEmpty = models.length === 0 && !loading && !error;
  const rows = (
    <ModelResultsProvider value={reportResults}>
      {picks.length > 0 ? (
        <ModelSection
          id="recommended"
          label="Recommended"
          models={picks}
          selected={selected}
          onSelect={onSelect}
          providerId={providerId}
          search={search}
        />
      ) : null}
      <ModelSection
        id="models"
        label={picks.length > 0 ? "All models" : undefined}
        models={models}
        selected={selected}
        onSelect={onSelect}
        providerId={providerId}
        search={search}
        loading={loading}
        error={error}
        retry={retry}
      />
      {isEmpty ? <DropdownMenuEmpty>No models available</DropdownMenuEmpty> : null}
    </ModelResultsProvider>
  );

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (!open) search.reset();
      }}
    >
      <DropdownMenuSubTrigger value={value}>Model</DropdownMenuSubTrigger>
      {isLong ? (
        <DropdownMenuSubContent size="wide" viewport="searchable">
          <DropdownMenuSearch
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder="Search models…"
            autoFocus
          />
          <DropdownMenuViewport>
            {rows}
            {search.isSearching && hasNoResults ? (
              <DropdownMenuEmpty>No matching models</DropdownMenuEmpty>
            ) : null}
          </DropdownMenuViewport>
        </DropdownMenuSubContent>
      ) : (
        <DropdownMenuSubContent size="wide" viewport="list">
          {rows}
        </DropdownMenuSubContent>
      )}
    </DropdownMenuSub>
  );
}

interface EffortStep {
  value: string;
  label: string;
  description?: string;
}

/**
 * Every agent that exposes an ordered "how hard should it think" scale gets the same slider:
 * Codex reasoning efforts and the ACP `thought_level` session config both land here, in one
 * wording. An agent's "default" level sits apart as Auto, since it is not a point on the scale.
 */
function EffortSlider({
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
  const labelled = steps.map((step) => ({
    ...step,
    label: formatEffortLabel(step.value, step.label),
  }));
  return (
    <StepSlider
      label="Effort"
      steps={labelled.filter((step) => !isAutoEffort(step.value))}
      autoStep={labelled.find((step) => isAutoEffort(step.value))}
      value={selected}
      onValueChange={onSelect}
      markedValue={defaultValue}
      markedLabel="Default"
    />
  );
}

export function AthasModelSubmenu({
  value,
  selected,
  onSelect,
}: {
  value: string;
  selected: string;
  onSelect: (modelId: string) => void;
}) {
  const { models, recommended, loading, error, retry } = useAthasModels(selected);
  return (
    <ModelSubmenu
      value={value}
      models={models}
      recommended={recommended}
      selected={selected}
      onSelect={onSelect}
      providerId="athas"
      loading={loading}
      error={error}
      retry={retry}
    />
  );
}

export function ProviderModelSubmenu({
  value,
  providerId,
  selected,
  onSelect,
}: {
  value: string;
  providerId: string;
  selected: string;
  onSelect: (modelId: string) => void;
}) {
  const { models, loading, error, retry } = useProviderModels(providerId, selected);
  return (
    <ModelSubmenu
      value={value}
      models={models}
      selected={selected}
      onSelect={onSelect}
      providerId={providerId}
      loading={loading}
      error={error}
      retry={retry}
    />
  );
}

export function CodexModelSubmenus({ cwd, value }: { cwd: string; value: string }) {
  const { settings, update } = useCodexSettings();
  const { models, loading, error, retry } = useCodexModels(cwd);
  const current = models.find((model) =>
    settings.model ? model.id === settings.model : model.isDefault,
  );
  const efforts = current?.reasoningEfforts ?? [];

  return (
    <>
      <ModelSubmenu
        value={value}
        models={[{ id: "default", name: "Default" }, ...models]}
        selected={settings.model || "default"}
        onSelect={(id) =>
          update(getCodexModelPatch(id === "default" ? undefined : id, models, settings))
        }
        providerId={CODEX_INTEGRATION_ID}
        loading={loading}
        error={error}
        retry={retry}
      />
      {current && efforts.length > 1 ? (
        <EffortSlider
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
      ) : null}
    </>
  );
}

function findSelectOption(options: SessionConfigOption[], category: "model" | "thought_level") {
  const option = options.find(
    (candidate) =>
      classifySessionConfigOption(candidate) === category && candidate.kind.type === "select",
  );
  return option?.kind.type === "select" && option.kind.options.length > 1
    ? { id: option.id, ...option.kind }
    : null;
}

/**
 * The ACP agent's model and effort rows. While its session is opening (`loading`), the Model row
 * shows the agent's last known models, or only a loading row before it ever reported any.
 */
export function AcpModelSubmenus({
  agentId,
  agentIcon,
  value,
  options,
  loading = false,
  onChange,
}: {
  agentId: string;
  agentIcon?: string | null;
  value: string;
  options: SessionConfigOption[];
  loading?: boolean;
  onChange: (optionId: string, value: SessionConfigValue) => void;
}) {
  const model = findSelectOption(options, "model");
  const effort = findSelectOption(options, "thought_level");

  return (
    <>
      {model || loading ? (
        <ModelSubmenu
          value={value}
          models={
            model?.options.map((option) => ({
              id: option.id,
              name: option.name,
              tooltip: option.description ? `${option.name} · ${option.description}` : undefined,
              iconId: agentId,
              iconUrl: agentIcon,
            })) ?? []
          }
          selected={model?.currentValue ?? ""}
          onSelect={(id) => {
            if (model) onChange(model.id, id);
          }}
          providerId={agentId}
          loading={loading}
        />
      ) : null}
      {effort ? (
        <EffortSlider
          steps={effort.options.map((option) => ({
            value: option.id,
            label: option.name,
            description: option.description,
          }))}
          selected={effort.currentValue}
          onSelect={(id) => onChange(effort.id, id)}
        />
      ) : null}
    </>
  );
}
