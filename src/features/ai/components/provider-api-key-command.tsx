import {
  CheckCircle,
  MagnifyingGlass as Search,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { useAIChatStore } from "@/features/ai/store/store";
import { getAvailableProviders, getProviderById } from "@/features/ai/types/providers";
import { Button } from "@/ui/button";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
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
  v0: "https://v0.dev/chat/settings/keys",
  grok: "https://console.x.ai",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
};

const PLACEHOLDERS: Partial<Record<string, string>> = {
  openrouter: "sk-or-v1-xxxxxxxxxxxxxxxxxxxx",
  v0: "v0_xxxxxxxxxxxxxxxxxxxx",
  grok: "xai-xxxxxxxxxxxxxxxxxxxx",
  openai: "sk-xxxxxxxxxxxxxxxxxxxx",
};

export function ProviderApiKeyCommand({
  isOpen,
  onClose,
  initialProviderId,
}: ProviderApiKeyCommandProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [status, setStatus] = useState<"idle" | "valid" | "invalid">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const saveApiKey = useAIChatStore((state) => state.saveApiKey);
  const removeApiKey = useAIChatStore((state) => state.removeApiKey);
  const hasProviderApiKey = useAIChatStore((state) => state.hasProviderApiKey);

  const providers = useMemo(
    () => getAvailableProviders().filter((provider) => provider.requiresApiKey),
    [],
  );
  const selectedProvider = getProviderById(selectedProviderId);
  const hasExistingKey = selectedProviderId ? hasProviderApiKey(selectedProviderId) : false;
  const dashboardLink = selectedProviderId ? DASHBOARD_LINKS[selectedProviderId] : undefined;
  const placeholder =
    selectedProviderId && PLACEHOLDERS[selectedProviderId]
      ? PLACEHOLDERS[selectedProviderId]
      : "Enter API key...";

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
    if (!isOpen) return;
    const initialProvider = initialProviderId
      ? providers.find((provider) => provider.id === initialProviderId)
      : null;
    setSelectedProviderId(initialProvider?.id || providers[0]?.id || "");
    setQuery("");
    setApiKey("");
    setStatus("idle");
    setErrorMessage("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [initialProviderId, isOpen, providers]);

  useEffect(() => {
    if (!selectedProviderId) return;
    setApiKey(hasExistingKey ? "••••••••••••••••••••" : "");
    setStatus("idle");
    setErrorMessage("");
  }, [hasExistingKey, selectedProviderId]);

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
      setApiKey("••••••••••••••••••••");
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
    <Command isVisible={isOpen} onClose={onClose} className="max-h-[430px] w-[560px]">
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
                <CommandItem
                  key={provider.id}
                  isSelected={isSelected}
                  onClick={() => {
                    setSelectedProviderId(provider.id);
                    requestAnimationFrame(() => apiKeyInputRef.current?.focus());
                  }}
                  className="mb-1 px-2 py-2 last:mb-0"
                >
                  <ProviderIcon
                    providerId={provider.id}
                    size={14}
                    className="shrink-0 text-text-lighter"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-text">{provider.name}</span>
                  {hasKey ? (
                    <CheckCircle className="shrink-0 text-success" size={13} />
                  ) : (
                    <WarningCircle className="shrink-0 text-warning" size={13} />
                  )}
                </CommandItem>
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
                  <div className="truncate text-sm text-text">{selectedProvider.name}</div>
                  <div className="ui-text-xs text-text-lighter">
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
                <div className="flex items-center gap-1.5 text-success text-xs">
                  <CheckCircle />
                  API key saved.
                </div>
              )}
              {status === "invalid" && errorMessage && (
                <div className="flex items-center gap-1.5 text-error text-xs">
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
                    className="ui-font text-text-lighter text-xs hover:text-text"
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
                      size="xs"
                      onClick={() => void handleRemove()}
                      className="text-error hover:bg-error/10 hover:text-error"
                    >
                      <Trash />
                      <span>Remove</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="primary"
                    size="xs"
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
    </Command>
  );
}
