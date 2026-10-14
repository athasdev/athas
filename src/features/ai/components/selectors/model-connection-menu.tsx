import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { formatTokenCount } from "@/features/ai/lib/acp-usage";
import { formatUsageRate, getHostedModelPriceHint } from "@/features/ai/services/hosted-usage";
import {
  getModelIconId,
  getModelVendorName,
  pickRecommendedModels,
} from "@/features/ai/lib/model-vendor";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/ui/dropdown";
import { ArrowClockwiseIcon, WarningIcon } from "@/ui/icons";
import type { MenuSearch } from "@/ui/menu-search";
import { Spinner } from "@/ui/spinner";

const ModelResultsContext = createContext<((id: string, count: number) => void) | null>(null);

/**
 * Collects how many rows each section shows while the user searches, so a menu can say
 * "No matching models" once every section comes up empty. Wrap the sections in
 * `ModelResultsProvider` with the returned `reportResults`.
 */
export function useModelSearchResults() {
  const [resultCounts, setResultCounts] = useState<Record<string, number>>({});
  const reportResults = useCallback((id: string, count: number) => {
    setResultCounts((previous) =>
      previous[id] === count ? previous : { ...previous, [id]: count },
    );
  }, []);
  return {
    reportResults,
    hasNoResults: Object.values(resultCounts).every((count) => count === 0),
  };
}

export const ModelResultsProvider = ModelResultsContext;

export interface ModelOption {
  id: string;
  name: string;
  keywords?: string[];
  /** Vendor, price and context details, shown only in the row's tooltip. */
  tooltip?: string;
  /** Overrides the icon derived from the section's provider and the model id. */
  iconId?: string;
  iconUrl?: string | null;
  disabled?: boolean;
}

interface ModelSectionProps {
  /** Unique within one menu; keys the section's search result count. */
  id: string;
  /** Omitted when the section is the menu's only list, such as a model submenu. */
  label?: string;
  models: ModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  /** Icon fallback for rows whose id names no known vendor. */
  providerId: string;
  /** Omitted when the menu has no search box. */
  search?: MenuSearch;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  disabled?: boolean;
  /** False keeps the menu open after a pick, for a parent that moves focus elsewhere itself. */
  closeOnClick?: boolean;
}

function joinTooltip(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

/**
 * One headed group of model rows. It hides itself when it has nothing to show, and while the
 * user searches it keeps only the rows that match, or every row when its own name matches.
 */
export function ModelSection({
  id,
  label,
  models,
  selected,
  onSelect,
  providerId,
  search,
  loading,
  error,
  retry,
  disabled,
  closeOnClick = true,
}: ModelSectionProps) {
  const isSearching = search?.isSearching ?? false;
  const filtered =
    search?.filter(models, (model) => [model.name, model.id, label, ...(model.keywords ?? [])]) ??
    models;
  const showStatus =
    Boolean(loading || error) &&
    (!isSearching || Boolean(label && search?.filter([label], (name) => [name]).length));
  const count = filtered.length + (showStatus ? 1 : 0);
  const reportResults = useContext(ModelResultsContext);
  useEffect(() => {
    reportResults?.(id, count);
    return () => reportResults?.(id, 0);
  }, [count, id, reportResults]);

  if (count === 0) return null;

  return (
    <DropdownMenuGroup>
      {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
      {showStatus && loading ? (
        <DropdownMenuItem disabled>
          <Spinner label={label ? `Loading ${label} models` : "Loading models"} compact />
          Loading…
        </DropdownMenuItem>
      ) : null}
      {showStatus && !loading && error ? (
        <DropdownMenuItem
          closeOnClick={false}
          onClick={retry}
          disabled={!retry}
          title={error}
          aria-label={retry ? `${error} Retry` : error}
        >
          <WarningIcon />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          {retry ? <ArrowClockwiseIcon /> : null}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
        {filtered.map((model) => (
          <DropdownMenuRadioItem
            key={model.id}
            value={model.id}
            closeOnClick={closeOnClick}
            disabled={disabled || model.disabled}
            title={model.tooltip ?? model.name}
          >
            <ProviderIcon
              providerId={model.iconId ?? getModelIconId(providerId, model.id)}
              iconUrl={model.iconUrl}
            />
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

function toAthasOption(
  model: {
    id: string;
    name: string;
    contextWindow?: number;
    input?: number;
    output?: number;
  },
  usageRate: string,
): ModelOption {
  if (model.id === "auto")
    return {
      id: model.id,
      name: model.name,
      tooltip: joinTooltip([model.name, "Athas picks the model for each request"]),
    };
  const vendor = getModelVendorName(model.id);
  const price = getHostedModelPriceHint(model);
  return {
    id: model.id,
    name: model.name,
    keywords: vendor ? [vendor] : undefined,
    tooltip: joinTooltip([
      model.name,
      vendor,
      price ? `${price} per million tokens, billed at ${usageRate}` : undefined,
      model.contextWindow ? `${formatTokenCount(model.contextWindow)} context` : undefined,
    ]),
  };
}

/**
 * The Athas catalog as menu rows, plus a short "Recommended" pick that only shows while the
 * catalog is reachable, which is what having Athas access looks like here.
 */
export function useAthasModels(selected: string) {
  const { availableModels, isLoadingModels, modelFetchError, retry } = useAIModelOptions(
    "athas",
    selected || "auto",
  );
  const catalog = useAIChatStore((state) => state.dynamicModels.athas);
  const usageMarkup = useAuthStore(
    (state) => state.subscription?.intelligence?.credits?.usageMarkup,
  );
  const usageRate = formatUsageRate(usageMarkup);
  const models = (catalog ?? availableModels).map((model) => toAthasOption(model, usageRate));
  return {
    models,
    recommended: modelFetchError ? [] : pickRecommendedModels(models),
    loading: isLoadingModels,
    error: modelFetchError,
    retry,
  };
}

/** One connected provider's models as menu rows. */
export function useProviderModels(providerId: string, selected: string) {
  const { availableModels, isLoadingModels, modelFetchError, retry } = useAIModelOptions(
    providerId,
    selected,
  );
  return {
    models: availableModels.map((model): ModelOption => ({
      id: model.id,
      name: model.name,
      tooltip: joinTooltip([
        model.name,
        model.contextWindow ? `${formatTokenCount(model.contextWindow)} context` : undefined,
      ]),
    })),
    loading: isLoadingModels,
    error: modelFetchError,
    retry,
  };
}

/**
 * The Athas catalog as two sections: a short "Recommended" pick (hidden while searching, since
 * every pick also sits in the full list) and "Athas" with every hosted model.
 */
export function AthasModelSections({
  selected,
  search,
  onSelect,
}: {
  selected: string;
  search: MenuSearch;
  onSelect: (model: string) => void;
}) {
  const { models, recommended, loading, error, retry } = useAthasModels(selected);

  return (
    <>
      {recommended.length > 0 && !search.isSearching ? (
        <ModelSection
          id="recommended"
          label="Recommended"
          models={recommended}
          selected={selected}
          onSelect={onSelect}
          providerId="athas"
          search={search}
        />
      ) : null}
      <ModelSection
        id="athas"
        label="Athas"
        models={models}
        selected={selected}
        onSelect={onSelect}
        providerId="athas"
        search={search}
        loading={loading}
        error={error}
        retry={retry}
      />
    </>
  );
}

export function ProviderModels({
  providerId,
  providerName,
  selected,
  search,
  onSelect,
}: {
  providerId: string;
  providerName: string;
  selected: string;
  search: MenuSearch;
  onSelect: (model: string) => void;
}) {
  const { models, loading, error, retry } = useProviderModels(providerId, selected);
  return (
    <ModelSection
      id={providerId}
      label={providerName}
      models={models}
      selected={selected}
      onSelect={onSelect}
      providerId={providerId}
      search={search}
      loading={loading}
      error={error}
      retry={retry}
    />
  );
}
