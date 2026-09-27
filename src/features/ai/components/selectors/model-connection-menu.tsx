import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIModelOptions } from "@/features/ai/hooks/use-ai-model-options";
import { useAvailableProviders } from "@/features/ai/hooks/use-available-providers";
import { formatTokenCount } from "@/features/ai/lib/acp-usage";
import { getHostedModelPriceHint } from "@/features/ai/lib/hosted-usage";
import { getModelIconId, getModelVendorName } from "@/features/ai/lib/model-vendor";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import {
  DropdownMenuEmpty,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { ArrowClockwiseIcon, WarningIcon } from "@/ui/icons";
import { useMenuSearch, type MenuSearch } from "@/ui/menu-search";
import { Spinner } from "@/ui/spinner";

const ModelResultsContext = createContext<((id: string, count: number) => void) | null>(null);

/**
 * Collects how many rows each connection shows while the user searches, so a menu can say
 * "No matching models" once every connection comes up empty. Wrap the connections in the
 * returned `ResultsProvider`.
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

/**
 * The providers a model menu offers besides Athas: every one the user connected, plus the one
 * currently selected so an existing choice never disappears from its own menu.
 */
export function useConnectedModelProviders(selectedProviderIds: string[] = []) {
  const providers = useAvailableProviders();
  const providerKeys = useAIChatStore((state) => state.providerApiKeys);
  return providers.filter(
    (provider) =>
      provider.id !== "athas" &&
      (selectedProviderIds.includes(provider.id) || providerKeys.get(provider.id)),
  );
}

/** A model's display name, from the fetched catalog first and the static list second. */
export function useModelName(providerId: string, modelId: string) {
  const providers = useAvailableProviders();
  const dynamicModels = useAIChatStore((state) => state.dynamicModels);
  return (
    dynamicModels[providerId]?.find((model) => model.id === modelId)?.name ??
    providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.name ??
    null
  );
}

/** Past this many models a connection's submenu gets its own search box. */
const SEARCHABLE_SUBMENU_THRESHOLD = 10;

export interface ModelOption {
  id: string;
  name: string;
  keywords?: string[];
  /** Short trailing text in the connection's submenu, such as the context window. */
  detail?: string;
  /** What the detail means, added to the row's tooltip when the detail alone is terse. */
  tooltip?: string;
  /** Rendered above the rest of the connection's models, split off by a separator. */
  pinned?: boolean;
}

interface ConnectionProps {
  models: ModelOption[];
  selected: string;
  onSelect: (id: string) => void;
  providerId: string;
  providerName: string;
  iconUrl?: string | null;
  search: MenuSearch;
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
  disabled?: boolean;
  /**
   * Browse the connection's models in a submenu. While the user searches, every connection
   * flattens into one list so a model can be found without knowing where it lives.
   */
  nested?: boolean;
}

function ModelStatusRows({
  providerName,
  loading,
  error,
  retry,
}: Pick<ConnectionProps, "providerName" | "loading" | "error" | "retry">) {
  return (
    <>
      {loading ? (
        <DropdownMenuItem disabled>
          <Spinner label={`Loading ${providerName} models`} compact />
          Loading {providerName}…
        </DropdownMenuItem>
      ) : null}
      {error ? (
        <DropdownMenuItem closeOnClick={false} onClick={retry} disabled={!retry} title={error}>
          <WarningIcon />
          <span className="min-w-0 whitespace-normal">
            {providerName}: {error}
          </span>
          {retry ? <ArrowClockwiseIcon /> : null}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function ModelRadioItem({
  model,
  providerId,
  providerName,
  disabled,
  nested,
}: {
  model: ModelOption;
  providerId: string;
  providerName: string;
  disabled?: boolean;
  nested?: boolean;
}) {
  return (
    <DropdownMenuRadioItem
      value={model.id}
      closeOnClick
      disabled={disabled}
      title={`${model.name} via ${providerName}${model.tooltip ? `: ${model.tooltip}` : ""}`}
    >
      <ProviderIcon providerId={getModelIconId(providerId, model.id)} />
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      {nested ? (
        model.detail ? (
          <span className="shrink-0 text-subtle-foreground">{model.detail}</span>
        ) : null
      ) : (
        <span className="max-w-1/2 shrink-0 truncate text-subtle-foreground">
          via {providerName}
        </span>
      )}
    </DropdownMenuRadioItem>
  );
}

function ConnectionSubmenu({
  models,
  selected,
  onSelect,
  providerId,
  providerName,
  iconUrl,
  loading,
  error,
  retry,
  disabled,
}: Omit<ConnectionProps, "search" | "nested">) {
  const search = useMenuSearch();
  const searchable = models.length > SEARCHABLE_SUBMENU_THRESHOLD;
  const filtered = search.filter(models, (model) => [model.name, model.id]);
  const pinned = search.isSearching ? [] : filtered.filter((model) => model.pinned);
  const rest = search.isSearching ? filtered : filtered.filter((model) => !model.pinned);
  const current = models.find((model) => model.id === selected);
  const rows = (
    <>
      {search.isSearching ? null : (
        <ModelStatusRows
          providerName={providerName}
          loading={loading}
          error={error}
          retry={retry}
        />
      )}
      <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
        {pinned.map((model) => (
          <ModelRadioItem
            key={model.id}
            model={model}
            providerId={providerId}
            providerName={providerName}
            disabled={disabled}
            nested
          />
        ))}
        {pinned.length > 0 && rest.length > 0 ? <DropdownMenuSeparator /> : null}
        {rest.map((model) => (
          <ModelRadioItem
            key={model.id}
            model={model}
            providerId={providerId}
            providerName={providerName}
            disabled={disabled}
            nested
          />
        ))}
      </DropdownMenuRadioGroup>
    </>
  );

  return (
    <DropdownMenuSub onOpenChange={(open) => !open && search.reset()}>
      <DropdownMenuSubTrigger disabled={disabled}>
        <ProviderIcon providerId={providerId} iconUrl={iconUrl} />
        <span className="min-w-0 flex-1 truncate">{providerName}</span>
        {current ? (
          <span className="max-w-1/2 shrink-0 truncate text-subtle-foreground">{current.name}</span>
        ) : null}
      </DropdownMenuSubTrigger>
      {searchable ? (
        <DropdownMenuSubContent size="wide" viewport="searchable">
          <DropdownMenuSearch
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            placeholder={`Search ${providerName} models…`}
            autoFocus
          />
          <DropdownMenuViewport>
            {rows}
            {search.isSearching && filtered.length === 0 ? (
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

export function Connection({ search, nested = false, ...props }: ConnectionProps) {
  const { models, selected, onSelect, providerId, providerName, loading, error, disabled } = props;
  const flat = !nested || search.isSearching;
  const filtered = search.filter(models, (model) => [
    model.name,
    model.id,
    providerName,
    ...(model.keywords ?? []),
  ]);
  const showStatus =
    !search.isSearching ||
    search.filter([{ name: providerName }], (provider) => [provider.name]).length > 0;
  const reportResults = useContext(ModelResultsContext);
  const count = flat ? filtered.length + (showStatus && (loading || error) ? 1 : 0) : 1;
  useEffect(() => {
    reportResults?.(providerId, count);
    return () => reportResults?.(providerId, 0);
  }, [count, providerId, reportResults]);

  if (!flat) return <ConnectionSubmenu {...props} />;

  return (
    <>
      {showStatus ? (
        <ModelStatusRows
          providerName={providerName}
          loading={loading}
          error={error}
          retry={props.retry}
        />
      ) : null}
      <DropdownMenuRadioGroup value={selected} onValueChange={onSelect}>
        {filtered.map((model) => (
          <ModelRadioItem
            key={model.id}
            model={model}
            providerId={providerId}
            providerName={providerName}
            disabled={disabled}
          />
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function withContextWindow<T extends ModelOption & { contextWindow?: number }>(model: T) {
  return model.contextWindow
    ? { ...model, detail: `${formatTokenCount(model.contextWindow)} context` }
    : model;
}

export function AthasModels({
  selected,
  search,
  onSelect,
}: {
  selected: string;
  search: MenuSearch;
  onSelect: (model: string) => void;
}) {
  const { availableModels, isLoadingModels, modelFetchError, retry } = useAIModelOptions(
    "athas",
    selected || "auto",
  );
  const catalog = useAIChatStore((state) => state.dynamicModels.athas);
  return (
    <Connection
      models={(catalog ?? availableModels).map((model): ModelOption => {
        if (model.id === "auto")
          return { id: model.id, name: model.name, detail: "Best per request", pinned: true };
        const vendor = getModelVendorName(model.id);
        // The vendor already shows as the row's icon, so the list price says more.
        const price = getHostedModelPriceHint(model);
        return {
          id: model.id,
          name: model.name,
          keywords: vendor ? [vendor] : undefined,
          detail: price ?? vendor,
          tooltip: price
            ? `${price} per million tokens, input / output, billed at list price +10%`
            : undefined,
        };
      })}
      selected={selected}
      onSelect={onSelect}
      providerId="athas"
      providerName="Athas"
      search={search}
      loading={isLoadingModels}
      error={modelFetchError}
      retry={retry}
      nested
    />
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
  const { availableModels, isLoadingModels, modelFetchError, retry } = useAIModelOptions(
    providerId,
    selected,
  );
  return (
    <Connection
      models={availableModels.map(withContextWindow)}
      selected={selected}
      onSelect={onSelect}
      providerId={providerId}
      providerName={providerName}
      search={search}
      loading={isLoadingModels}
      error={modelFetchError}
      retry={retry}
      nested
    />
  );
}
