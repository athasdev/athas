import {
  CheckCircleIcon as CheckCircle,
  MagnifyingGlassIcon as Search,
  TrashIcon as Trash,
  WarningCircleIcon as WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import {
  useAvailableProviders,
  useProviderById,
} from "@/features/ai/hooks/use-available-providers";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";

interface ProviderApiKeyCommandProps {
  isOpen: boolean;
  onClose: () => void;
  initialProviderId?: string | null;
}

const DASHBOARD_LINKS: Partial<Record<string, string>> = {
  openrouter: "https://openrouter.ai/keys",
  grok: "https://console.x.ai",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
  mistral: "https://console.mistral.ai/api-keys",
};

const PLACEHOLDERS: Partial<Record<string, string>> = {
  openrouter: "sk-or-v1-xxxxxxxxxxxxxxxxxxxx",
  grok: "xai-xxxxxxxxxxxxxxxxxxxx",
  openai: "sk-xxxxxxxxxxxxxxxxxxxx",
  mistral: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

const MASKED_API_KEY = "••••••••••••••••••••";

export function ProviderApiKeyCommand({
  isOpen,
  onClose,
  initialProviderId,
}: ProviderApiKeyCommandProps) {
  return (
    <Command isVisible={isOpen} onClose={onClose} className="max-h-[430px] w-[560px]">
      {isOpen ? (
        <ProviderApiKeyCommandContent
          key={initialProviderId ?? "default"}
          onClose={onClose}
          initialProviderId={initialProviderId}
        />
      ) : null}
    </Command>
  );
}

function ProviderApiKeyCommandContent({
  onClose,
  initialProviderId,
}: Pick<ProviderApiKeyCommandProps, "onClose" | "initialProviderId">) {
  const searchRef = useRef<HTMLInputElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);

  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);

  const availableProviders = useAvailableProviders();
  const providers = useMemo(
    () => availableProviders.filter((provider) => provider.requiresApiKey),
    [availableProviders],
  );
  const initialProvider = initialProviderId
    ? providers.find((provider) => provider.id === initialProviderId)
    : null;
  const initialSelectedProviderId = initialProvider?.id || providers[0]?.id || "";
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>(initialSelectedProviderId);
  const [apiKey, setApiKey] = useState(() =>
    initialSelectedProviderId && hasProviderApiKey(initialSelectedProviderId) ? MASKED_API_KEY : "",
  );
  const [isValidating, setIsValidating] = useState(false);
  const [status, setStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedProvider = useProviderById(selectedProviderId);
  const hasExistingKey = selectedProviderId ? hasProviderApiKey(selectedProviderId) : false;
  const dashboardLink =
    selectedProvider?.apiKeyUrl ||
    (selectedProviderId ? DASHBOARD_LINKS[selectedProviderId] : undefined);
  const placeholder =
    selectedProvider?.apiKeyPlaceholder ||
    (selectedProviderId && PLACEHOLDERS[selectedProviderId]
      ? PLACEHOLDERS[selectedProviderId]
      : undefined) ||
    "Enter API key...";

  const filteredProviders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return providers.filter((provider) => {
      if (!normalizedQuery) return true;
      return (
        provider.name.toLowerCase().includes(normalizedQuery) ||
        provider.id.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [providers, query]);

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, []);

  const handleSave = async () => {
    if (!selectedProviderId) return;
    if (hasExistingKey && apiKey.startsWith("•")) return;
    if (!apiKey.trim()) {
      setStatus("invalid");
      setErrorMessage("Please enter an API key.");
      return;
    }

    setIsValidating(true);
    setStatus("idle");
    setErrorMessage("");
    try {
      const isValid = await saveApiKey(selectedProviderId, apiKey);
      if (!isValid) {
        setStatus("invalid");
        setErrorMessage("Invalid API key.");
        return;
      }
      setStatus("valid");
      setApiKey(MASKED_API_KEY);
    } catch {
      setStatus("invalid");
      setErrorMessage("Failed to validate API key.");
    } finally {
      setIsValidating(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedProviderId) return;
    try {
      await removeApiKey(selectedProviderId);
      setApiKey("");
      setStatus("idle");
      setErrorMessage("");
    } catch {
      setStatus("invalid");
      setErrorMessage("Failed to remove API key.");
    }
  };

  return (
    <>
      <CommandHeader onClose={onClose}>
        <Search className="shrink-0 text-text-lighter" size={14} />
        <CommandInput
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder="Search API key providers..."
        />
      </CommandHeader>

      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
        <CommandList>
          {filteredProviders.length === 0 ? (
            <CommandEmpty>No providers found</CommandEmpty>
          ) : (
            filteredProviders.map((provider) => {
              const isSelected = provider.id === selectedProviderId;
              const hasKey = hasProviderApiKey(provider.id);

              return (
                <CommandItemRow
                  key={provider.id}
                  isSelected={isSelected}
                  onClick={() => {
                    setSelectedProviderId(provider.id);
                    setApiKey(hasProviderApiKey(provider.id) ? MASKED_API_KEY : "");
                    setStatus("idle");
                    setErrorMessage("");
                    requestAnimationFrame(() => apiKeyInputRef.current?.focus());
                  }}
                  icon={
                    <ProviderIcon
                      providerId={provider.id}
                      size={14}
                      className="text-text-lighter"
                    />
                  }
                  title={provider.name}
                  accessory={
                    hasKey ? (
                      <CheckCircle className="text-success" size={13} />
                    ) : (
                      <WarningCircle className="text-warning" size={13} />
                    )
                  }
                />
              );
            })
          )}
        </CommandList>

        <div className="min-w-0 border-border border-l p-3">
          {selectedProvider ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ProviderIcon
                  providerId={selectedProvider.id}
                  size={16}
                  className="shrink-0 text-text-lighter"
                />
                <div className="min-w-0">
                  <div className="truncate ui-text-base text-text">{selectedProvider.name}</div>
                  <div className="ui-text-base text-text-lighter">
                    {hasExistingKey ? "API key saved" : "API key required"}
                  </div>
                </div>
              </div>

              <Input
                ref={apiKeyInputRef}
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setStatus("idle");
                  setErrorMessage("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSave();
                  }
                }}
                placeholder={placeholder}
                disabled={isValidating}
                autoComplete="off"
              />

              {status === "valid" && (
                <div className="flex items-center gap-1.5 text-success ui-text-base">
                  <CheckCircle />
                  API key saved.
                </div>
              )}
              {status === "invalid" && errorMessage && (
                <div className="flex items-center gap-1.5 text-error ui-text-base">
                  <WarningCircle />
                  {errorMessage}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                {dashboardLink ? (
                  <a
                    href={dashboardLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-font text-text-lighter ui-text-base hover:text-text"
                  >
                    Open dashboard
                  </a>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-1.5">
                  {hasExistingKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void handleRemove()}
                      className="text-error hover:bg-error/10 hover:text-error"
                    >
                      <Trash />
                      <span>Remove</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="accent"
                    onClick={() => void handleSave()}
                    disabled={!apiKey.trim() || isValidating || apiKey.startsWith("•")}
                    className={cn(isValidating && "opacity-70")}
                  >
                    <span>{isValidating ? "Validating" : "Save key"}</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <CommandEmpty>Select a provider</CommandEmpty>
          )}
        </div>
      </div>
    </>
  );
}
