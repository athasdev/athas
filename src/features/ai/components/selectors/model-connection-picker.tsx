import { useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useProviderById } from "@/features/ai/hooks/use-available-providers";
import { getModelIconId } from "@/features/ai/lib/model-vendor";
import type { IntelligenceConnection } from "@/features/ai/intelligence/types/intelligence.types";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@/ui/dropdown";
import { ChevronDownIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";
import { useMenuSearch } from "@/ui/menu-search";
import {
  AthasModelSections,
  ModelResultsProvider,
  ModelSection,
  ProviderModels,
  useConnectedModelProviders,
  useModelName,
  useModelSearchResults,
} from "./model-connection-menu";

const INHERIT_VALUE = "inherit";

interface ModelConnectionPickerProps {
  /** The chosen connection, or null when the picker follows another setting. */
  value: IntelligenceConnection | null;
  onChange: (connection: IntelligenceConnection | null) => void;
  /** Offers a first row that clears the choice, such as "Same as default". */
  inheritLabel?: string;
  disabled?: boolean;
  /**
   * What the model is for. Tab completion offers Athas's one Tab model instead of the Athas chat
   * catalog, since hosted completions always run on it.
   */
  purpose?: "chat" | "completion";
  /** `full` fills the parent, such as a settings row's shared dropdown width. */
  width?: "content" | "full";
  "aria-label": string;
}

const ATHAS_TAB_MODEL_LABEL = "Athas Tab model";

function isAthasAutomatic(connection: IntelligenceConnection) {
  return (
    connection.providerId === "athas" && (!connection.modelId || connection.modelId === "auto")
  );
}

/**
 * Picks a model the same way the composer does: one searchable list with a section per
 * connection (Recommended and Athas, then every provider the user connected).
 */
export function ModelConnectionPicker({
  value,
  onChange,
  inheritLabel,
  disabled,
  purpose = "chat",
  width = "content",
  "aria-label": ariaLabel,
}: ModelConnectionPickerProps) {
  const [isContentMounted, setIsContentMounted] = useState(false);
  const search = useMenuSearch();
  const { reportResults, hasNoResults } = useModelSearchResults();
  const providerId = value?.providerId ?? "";
  const modelId = value?.modelId ?? "";
  const provider = useProviderById(providerId);
  const modelName = useModelName(providerId, modelId);
  const providers = useConnectedModelProviders(providerId ? [providerId] : []);
  const label = !value
    ? (inheritLabel ?? "Choose a model")
    : value.providerId === "auto"
      ? // Saved by the earlier settings page: resolves like Automatic, not like the default.
        "Automatic"
      : isAthasAutomatic(value)
        ? purpose === "completion"
          ? ATHAS_TAB_MODEL_LABEL
          : "Athas Automatic"
        : modelName || modelId || provider?.name || providerId;
  const title =
    value && provider && !isAthasAutomatic(value) ? `${label} via ${provider.name}` : label;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setIsContentMounted(open);
        if (!open) search.reset();
      }}
    >
      <span className={cn("inline-flex min-w-0 max-w-full", width === "full" && "w-full")}>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              type="button"
              variant="outline"
              width={width}
              align="between"
              aria-label={`${ariaLabel}: ${label}`}
              title={title}
            />
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {value ? <ProviderIcon providerId={getModelIconId(providerId, modelId)} /> : null}
            <span className="min-w-0 truncate">{label}</span>
          </span>
          <ChevronDownIcon size={12} className="shrink-0 text-subtle-foreground" />
        </DropdownMenuTrigger>
      </span>
      <DropdownMenuContent align="end" viewport="searchable" size="wide">
        <DropdownMenuSearch
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder="Select a model…"
          autoFocus
        />
        <DropdownMenuViewport>
          {inheritLabel && !search.isSearching ? (
            <>
              <DropdownMenuRadioGroup
                value={value ? "" : INHERIT_VALUE}
                onValueChange={() => onChange(null)}
              >
                <DropdownMenuRadioItem value={INHERIT_VALUE} closeOnClick>
                  {inheritLabel}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {isContentMounted ? (
            <ModelResultsProvider value={reportResults}>
              {purpose === "completion" ? (
                <ModelSection
                  id="athas"
                  label="Athas"
                  models={[{ id: "auto", name: ATHAS_TAB_MODEL_LABEL, keywords: ["automatic"] }]}
                  selected={value && providerId === "athas" ? modelId || "auto" : ""}
                  onSelect={(id) => onChange({ providerId: "athas", modelId: id })}
                  providerId="athas"
                  search={search}
                />
              ) : (
                <AthasModelSections
                  selected={value && providerId === "athas" ? modelId || "auto" : ""}
                  search={search}
                  onSelect={(id) => onChange({ providerId: "athas", modelId: id })}
                />
              )}
              {providers.map((item) => (
                <ProviderModels
                  key={item.id}
                  providerId={item.id}
                  providerName={item.name}
                  selected={item.id === providerId ? modelId : ""}
                  search={search}
                  onSelect={(id) => onChange({ providerId: item.id, modelId: id })}
                />
              ))}
            </ModelResultsProvider>
          ) : null}
          {isContentMounted && search.isSearching && hasNoResults ? (
            <DropdownMenuEmpty>No matching models</DropdownMenuEmpty>
          ) : null}
        </DropdownMenuViewport>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
